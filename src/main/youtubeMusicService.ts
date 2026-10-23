import { app, BrowserWindow, session, type Session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { Innertube, Platform, Constants, Log, YTNodes } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger, LogLevel } from 'googlevideo/utils';
import { buildURL, getHeaders, USER_AGENT, parseLooseJSON } from 'bgutils-js/utils';
import { isYouTubeVideoId, type YouTubeSearchResponse, type YouTubePlayResponse } from '../shared/youtubeMusic';
import { YouTubeSearchPager, type YouTubeSearchPage } from './youtubeSearchPager';
import { fetchMusicStream } from './musicStreamFetch';
import { OfflineMusicCache } from './offlineMusicCache';
import { lookupMusicQuery } from './youtubeMusicLookup';

const REQUEST_TIMEOUT_MS = 20_000;
const PREPARED_TTL_MS = 120_000;
const PREPARED_REFRESH_MARGIN_MS = 45_000;
const PREPARED_MAX = 4;
const TOKEN_TTL_MS = 15 * 60 * 1000;
/** Kurulumda üç ağ isteği ve bir sayfa yüklemesi var; yavaş bağlantıda başarıyla biten kurulum düşmesin. */
const TOKEN_SETUP_TIMEOUT_MS = 60_000;
/** Sunucu ek medya vermezse sıcak istek döngüsünü önler. İlk istek beklemez. */
const SABR_REQUEST_GAP_MS = 200;
/** Token penceresi yalnızca ana belgeyi yükler; script, görsel, font ve diğer alt kaynaklar iptal edilir. */
const TOKEN_ALLOWED_RESOURCES: ReadonlySet<string> = new Set(['mainFrame', 'xhr', 'webSocket']);
const INTERPRETER_HOSTS: ReadonlySet<string> = new Set(['www.google.com', 'www.gstatic.com', 'www.youtube.com']);
const YTCFG_RE = /ytcfg\.set\(({.+?})\);/s;
const CHALLENGE_RE = /window\.ytAtN\(\s*({[\s\S]*?})\s*\)/;

const hardenedSessions = new WeakSet<Session>();

const fetchTimed: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

function hardenTokenSession(anonymous: Session): void {
  if (hardenedSessions.has(anonymous)) return;
  hardenedSessions.add(anonymous);
  anonymous.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  anonymous.setPermissionCheckHandler(() => false);
  anonymous.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !TOKEN_ALLOWED_RESOURCES.has(details.resourceType) }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { onTimeout(); reject(new Error('token-timeout')); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type SearchPageSource = Awaited<ReturnType<Innertube['search']>>;

function adaptSearchPage(page: SearchPageSource): YouTubeSearchPage {
  return {
    results: page.videos.filterType(YTNodes.Video).map(video => ({
      id: video.id, title: video.title.toString(), duration: video.duration?.seconds ?? 0,
    })),
    next: page.has_continuation ? async () => adaptSearchPage(await page.getContinuation()) : undefined,
  };
}

function abortSabr(sabr: SabrStream | undefined): void {
  try { sabr?.abort(); } catch { /* Completed streams may already be closed. */ }
}

interface ActiveStream {
  id: string;
  path: string;
  mimeType: string;
  audio: ReadableStream<Uint8Array>;
  sabr: SabrStream;
  reader?: Readable;
  response?: http.ServerResponse;
  finished: boolean;
  videoId: string;
}

type PreparedTrack = {
  info: Awaited<ReturnType<Innertube['getBasicInfo']>>;
  token: string;
  url: string;
  port: number;
};

interface PreparedEntry { expires: number; promise: Promise<PreparedTrack> }

/** Anonymous music service. Renderer receives only metadata and a random loopback URL. */
export class YouTubeMusicService {
  private readonly offline = new OfflineMusicCache(path.join(app.getPath('userData'), 'offline-music'), async (id, cancelled) => {
    const { stream } = await this.createAudio(id, cancelled);
    return { audio: stream.audio, mimeType: stream.mimeType, finished: () => stream.finished, abort: () => abortSabr(stream.sabr) };
  });
  private readonly searchPager = new YouTubeSearchPager(async query => {
    const youtube = await this.getYouTube();
    return adaptSearchPage(await youtube.search(query, { type: 'video' }));
  });
  private readonly prepared = new Map<string, PreparedEntry>();
  private youtube?: Promise<Innertube>;
  private tokenReady?: Promise<BrowserWindow>;
  private tokenWindow?: BrowserWindow;
  private tokenCreated = 0;
  private tokenGeneration = 0;
  private server?: http.Server;
  private serverReady?: Promise<number>;
  private active?: ActiveStream;
  private generation = 0;
  private disposed = false;

  offlineStatus(id: unknown) { return this.offline.status(id); }
  download(id: unknown) { return this.offline.download(id); }
  cancelDownload(id: unknown) { this.offline.cancel(id); }

  /** Uygulama açılışında çağrılırsa ilk arama/çalma Innertube kurulumunu beklemez. Token penceresini kurmaz. */
  warmup(): void {
    if (!this.disposed) void this.getYouTube().catch(() => {});
  }

  /** Warm connection metadata only: never replaces the active stream or starts audio. */
  private prepareTrack(id: string, refresh = false): Promise<PreparedTrack> {
    const cached = this.prepared.get(id);
    if (cached && cached.expires > Date.now() + (refresh ? PREPARED_REFRESH_MARGIN_MS : 0)) return cached.promise;
    this.prepared.delete(id);
    const promise = this.loadTrack(id).then(
      track => { entry.expires = Date.now() + PREPARED_TTL_MS; return track; },
      error => {
        if (this.prepared.get(id) === entry) this.prepared.delete(id);
        throw error;
      },
    );
    const entry: PreparedEntry = { expires: Date.now() + PREPARED_TTL_MS, promise };
    this.prepared.set(id, entry);
    while (this.prepared.size > PREPARED_MAX) this.prepared.delete(this.prepared.keys().next().value!);
    return promise;
  }

  private async loadTrack(id: string): Promise<PreparedTrack> {
    // Innertube oturumu ve token tarayıcısı birbirinden bağımsız: soğuk başlangıçta paralel kurulur.
    // Oynatma bağlamı (getBasicInfo) ikisi de hazır olduktan sonra alınır; token kurulumu
    // saniyeler sürebilir ve önce alınan bağlam bu sürede eskir.
    const [youtube, token] = await Promise.all([this.getYouTube(), this.mintToken(id)]);
    const [info, port] = await Promise.all([youtube.getBasicInfo(id, { client: 'WEB' }), this.ensureServer()]);
    if (this.disposed) throw new Error('cancelled');
    if (info.playability_status?.status !== 'OK') throw new Error('unavailable-video');
    const url = await youtube.session.player!.decipher(info.streaming_data?.server_abr_streaming_url);
    if (this.disposed) throw new Error('cancelled');
    return { info, token, url, port };
  }

  async prepare(id: unknown): Promise<{ ok: boolean }> {
    if (this.disposed || !isYouTubeVideoId(id)) return { ok: false };
    if (await this.offline.file(id)) return { ok: true };
    if (this.active?.videoId === id) return { ok: true };
    try { await this.prepareTrack(id, true); return { ok: !this.disposed }; }
    catch { return { ok: false }; }
  }

  private getYouTube(): Promise<Innertube> {
    if (!this.youtube) {
      Log.setLevel(Log.Level.NONE);
      Logger.getInstance().setLogLevels(LogLevel.NONE);
      Platform.shim.eval = data => vm.runInNewContext(`(function(){${data.output}\n})()`, Object.create(null), { timeout: 3000 });
      this.youtube = Innertube.create({ fetch: fetchTimed, lang: 'en', location: 'TR', enable_session_cache: false })
        .catch(error => { this.youtube = undefined; throw error; });
    }
    return this.youtube;
  }

  async search(query: unknown, cursor?: unknown): Promise<YouTubeSearchResponse> {
    if (this.disposed) return { ok: false, error: 'unavailable' };
    const result = await lookupMusicQuery(
      query, cursor,
      (text, next) => this.searchPager.search(text, next),
      id => this.lookupVideo(id),
    );
    return this.disposed ? { ok: false, error: 'unavailable' } : result;
  }

  private async lookupVideo(id: string) {
    const youtube = await this.getYouTube();
    const info = await youtube.getBasicInfo(id);
    if (info.playability_status?.status !== 'OK') throw new Error('video-unavailable');
    return { id, title: info.basic_info.title ?? '', duration: info.basic_info.duration ?? 0 };
  }

  private async createTokenWindow(generation: number): Promise<BrowserWindow> {
    // Adapted from GoogleVideo's MIT-licensed webpo-helper example.
    // Remote code runs in Chromium with no Node/preload/API bridge.
    // Her await sonrasında: kapatılmış veya geçersiz kılınmış kurulum boşuna sürmesin.
    const check = () => {
      if (this.disposed || generation !== this.tokenGeneration) throw new Error('cancelled');
    };
    check();
    const response = await fetchTimed('https://www.youtube.com', { headers: {
      'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.7',
    } });
    check();
    const html = await response.text();
    check();
    const configText = YTCFG_RE.exec(html)?.[1];
    const challengeText = CHALLENGE_RE.exec(html)?.[1];
    if (!configText || !challengeText) throw new Error('challenge-unavailable');
    const challenge = parseLooseJSON(challengeText)?.R?.bgChallenge;
    if (!challenge) throw new Error('challenge-unavailable');
    const interpreterURL = new URL(challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue, 'https://www.youtube.com');
    if (interpreterURL.protocol !== 'https:' || !INTERPRETER_HOSTS.has(interpreterURL.hostname)) throw new Error('invalid-interpreter');
    const interpreterResponse = await fetchTimed(interpreterURL);
    check();
    const interpreter = await interpreterResponse.text();
    check();

    const anonymous = session.fromPartition('youtube-music-anonymous');
    hardenTokenSession(anonymous);
    const tokenWindow = new BrowserWindow({ show: false, webPreferences: {
      session: anonymous, sandbox: true, nodeIntegration: false, contextIsolation: true,
      webSecurity: true, backgroundThrottling: false,
    } });
    this.tokenWindow = tokenWindow;
    tokenWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await tokenWindow.loadURL('https://www.youtube.com');
      check();
      const bundle = await fs.readFile(path.join(__dirname, 'youtube-token.js'), 'utf8');
      check();
      await tokenWindow.webContents.executeJavaScript(bundle);
      check();
      await tokenWindow.webContents.executeJavaScript(`window.yt = { config_: ${configText} };\n${interpreter}`);
      check();
      const snapshot = await tokenWindow.webContents.executeJavaScript(`(async () => { try {
        window.musicSignals = [];
        window.musicClient = await window.musicBotGuard.BotGuardClient.create({
          program: ${JSON.stringify(challenge.program)}, globalName: ${JSON.stringify(challenge.globalName)}, globalObject: window
        });
        return { value: await window.musicClient.snapshot({ webPoSignalOutput: window.musicSignals }) };
      } catch { return { error: true }; } })()`);
      check();
      if (snapshot.error) throw new Error('token-unavailable');
      const integrityResponse = await fetchTimed(buildURL('GenerateIT', true), {
        method: 'POST', headers: getHeaders(), body: JSON.stringify(['O43z0dpjhgX20SCx4KAo', snapshot.value]),
      });
      check();
      if (!integrityResponse.ok) throw new Error('token-unavailable');
      const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await integrityResponse.json();
      check();
      const tokenData = { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken };
      const success = await tokenWindow.webContents.executeJavaScript(`(async () => { try {
        window.musicMinter = await window.musicBotGuard.WebPoMinter.create(${JSON.stringify(tokenData)}, window.musicSignals);
        return true;
      } catch { return false; } })()`);
      check();
      if (!success) throw new Error('token-unavailable');
      this.tokenCreated = Date.now();
      return tokenWindow;
    } catch (error) {
      if (!tokenWindow.isDestroyed()) tokenWindow.destroy();
      if (this.tokenWindow === tokenWindow) this.tokenWindow = undefined;
      throw error;
    }
  }

  /** Mevcut ve devam eden kurulumları geçersiz kılar; eski kurulumun sonraki adımları `check()` ile düşer. */
  private invalidateToken(): void {
    this.tokenGeneration++;
    if (this.tokenWindow && !this.tokenWindow.isDestroyed()) this.tokenWindow.destroy();
    this.tokenWindow = undefined;
    this.tokenReady = undefined;
    this.tokenCreated = 0;
  }

  private startTokenSetup(): Promise<BrowserWindow> {
    const generation = this.tokenGeneration;
    const ready = withTimeout(this.createTokenWindow(generation), TOKEN_SETUP_TIMEOUT_MS, () => {
      if (generation === this.tokenGeneration) this.invalidateToken();
    });
    // Yalnızca kendi denemesi hâlâ güncelse sıfırla; yeni başlayan deneme ezilmesin.
    ready.catch(() => { if (this.tokenReady === ready) this.tokenReady = undefined; });
    return ready;
  }

  private async mintToken(id: string): Promise<string> {
    const stale = this.tokenWindow?.isDestroyed() || (this.tokenCreated > 0 && Date.now() - this.tokenCreated > TOKEN_TTL_MS);
    if (stale) this.invalidateToken();
    const ready = this.tokenReady ??= this.startTokenSetup();
    const tokenWindow = await ready;
    if (tokenWindow.isDestroyed()) {
      if (this.tokenReady === ready) this.invalidateToken();
      throw new Error('token-unavailable');
    }
    return tokenWindow.webContents.executeJavaScript(`window.musicMinter.mintAsWebsafeString(${JSON.stringify(id)})`);
  }

  private ensureServer(): Promise<number> {
    if (this.disposed) return Promise.reject(new Error('cancelled'));
    this.serverReady ??= this.listen().catch(error => {
      // Başarısız kurulum kalıcı olmasın: sonraki çağrı yeniden denesin.
      this.serverReady = undefined;
      this.server = undefined;
      throw error;
    });
    return this.serverReady;
  }

  private listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((request, response) => this.serve(request, response));
      this.server = server;
      // `once` yerine `on`: dinlemeye başladıktan sonraki bir hata süreci düşürmesin (reject ikinci kez etkisiz).
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') resolve(address.port);
        else reject(new Error('server-unavailable'));
      });
    });
  }

  private serve(request: http.IncomingMessage, response: http.ServerResponse): void {
    const stream = this.active;
    if (request.method !== 'GET' || !stream || request.url !== stream.path || stream.reader) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': stream.mimeType, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    stream.response = response;
    const reader = Readable.fromWeb(stream.audio as Parameters<typeof Readable.fromWeb>[0]);
    stream.reader = reader;
    reader.on('error', error => { console.warn('[youtube-music] audio-stream', error.message.slice(0, 180)); response.destroy(); });
    response.on('close', () => {
      reader.destroy();
      if (this.active === stream && !stream.finished) this.stop(stream.id);
    });
    reader.pipe(response);
  }

  private async createAudio(id: string, cancelled: () => boolean): Promise<{ stream: ActiveStream; port: number }> {
    let sabr: SabrStream | undefined;
    try {
      const preparation = this.prepareTrack(id);
      // Claim the single-use playback context before awaiting: another download/play
      // must obtain a separate context even while this request is still preparing.
      if (this.prepared.get(id)?.promise === preparation) this.prepared.delete(id);
      const { info, token, url, port } = await preparation;
      if (cancelled()) throw new Error('cancelled');
      // SABR playback context belongs to one stream. Reusing it for a restart can
      // return an initialization segment followed by no further media parts.
      let requests = 0;
      sabr = new SabrStream({
        serverAbrStreamingUrl: url,
        videoPlaybackUstreamerConfig: info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config,
        formats: info.streaming_data!.adaptive_formats.map(buildSabrFormat), poToken: token,
        clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS.WEB), clientVersion: Constants.CLIENTS.WEB.VERSION },
        fetch: async (input, init) => {
          // Avoid a hot request loop if the server supplies no additional media.
          // The first request cannot be part of a loop, so it goes out immediately.
          if (requests++ > 0) await sleep(SABR_REQUEST_GAP_MS);
          // Bound stalled reads, not the lifetime of a playing audio response.
          return fetchMusicStream(input, init);
        },
      });
      let stream: ActiveStream | undefined;
      let finished = false;
      sabr.on('finish', () => { finished = true; if (stream) stream.finished = true; });
      const { audioStream, selectedFormats } = await sabr.start({
        enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY, preferWebM: true, preferOpus: true,
        maxRetries: 2, stallDetectionMs: 15000,
      });
      if (cancelled()) throw new Error('cancelled');
      const streamId = randomBytes(24).toString('hex');
      stream = { id: streamId, path: `/audio/${streamId}`, audio: audioStream, videoId: id,
        mimeType: selectedFormats.audioFormat.mimeType!, sabr, finished };
      return { stream, port };
    } catch (error) {
      abortSabr(sabr);
      throw error;
    }
  }

  async play(id: unknown): Promise<YouTubePlayResponse> {
    if (this.disposed || !isYouTubeVideoId(id)) return { ok: false, error: 'invalid-video' };
    this.stop();
    const generation = this.generation;
    const cancelled = () => generation !== this.generation || this.disposed;
    try {
      const local = await this.offline.file(id);
      if (cancelled()) return { ok: false, error: 'cancelled' };
      if (local) return { ok: true, streamId: `offline-${id}`, url: `local-resource://mediafile/${encodeURIComponent(local)}` };
      const source = await this.createAudio(id, cancelled);
      if (cancelled()) {
        abortSabr(source.stream.sabr);
        return { ok: false, error: 'cancelled' };
      }
      this.active = source.stream;
      return { ok: true, streamId: source.stream.id, url: `http://127.0.0.1:${source.port}${source.stream.path}` };
    } catch (error) {
      this.prepared.delete(id);
      console.warn('[youtube-music] play', error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 180) : 'failed');
      return { ok: false, error: generation !== this.generation ? 'cancelled' : 'play-failed' };
    }
  }

  stop(streamId?: string): void {
    if (streamId && this.active?.id !== streamId) return;
    this.generation++;
    const stream = this.active;
    this.active = undefined;
    if (!stream) return;
    stream.reader?.destroy();
    stream.response?.destroy();
    abortSabr(stream.sabr);
  }

  dispose(): void {
    this.disposed = true;
    this.offline.dispose();
    this.prepared.clear();
    this.searchPager.clear();
    this.stop();
    this.invalidateToken();
    this.server?.closeAllConnections();
    this.server?.close();
  }
}