import { BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { Innertube, Platform, Constants, Log, YTNodes } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger, LogLevel } from 'googlevideo/utils';
import { buildURL, getHeaders, USER_AGENT, parseLooseJSON } from 'bgutils-js/utils';
import { isYouTubeVideoId, type YouTubeSearchResponse, type YouTubePlayResponse } from '../shared/youtubeMusic';
import { fetchMusicStream } from './musicStreamFetch';

const fetchTimed: typeof fetch = (input, init = {}) => fetch(input, {
  ...init,
  signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
});

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

/** Anonymous music service. Renderer receives only metadata and a random loopback URL. */
export class YouTubeMusicService {
  private youtube?: Promise<Innertube>;
  private tokenReady?: Promise<BrowserWindow>;
  private tokenWindow?: BrowserWindow;
  private tokenCreated = 0;
  private server?: http.Server;
  private serverReady?: Promise<number>;
  private active?: ActiveStream;
  private generation = 0;
  private disposed = false;
  private prepared = new Map<string, { expires: number; promise: Promise<PreparedTrack> }>();

  /** Warm connection metadata only: never replaces the active stream or starts audio. */
  private prepareTrack(id: string, refresh = false): Promise<PreparedTrack> {
    const cached = this.prepared.get(id);
    if (cached && cached.expires > Date.now() + (refresh ? 45000 : 0)) return cached.promise;
    this.prepared.delete(id);
    const entry = { expires: Date.now() + 120000, promise: undefined as unknown as Promise<PreparedTrack> };
    entry.promise = (async () => {
      const youtube = await this.getYouTube();
      // Get a fresh playback context after the token browser is ready. A cold
      // token setup can take seconds; fetching the context before it ages it.
      const token = await this.mintToken(id);
      const [info, port] = await Promise.all([
        youtube.getBasicInfo(id, { client: 'WEB' }), this.ensureServer(),
      ]);
      if (this.disposed) throw new Error('cancelled');
      if (info.playability_status?.status !== 'OK') throw new Error('unavailable-video');
      const url = await youtube.session.player!.decipher(info.streaming_data?.server_abr_streaming_url);
      if (this.disposed) throw new Error('cancelled');
      entry.expires = Date.now() + 120000;
      return { info, token, url, port };
    })().catch(error => {
      if (this.prepared.get(id) === entry) this.prepared.delete(id);
      throw error;
    });
    this.prepared.set(id, entry);
    while (this.prepared.size > 4) this.prepared.delete(this.prepared.keys().next().value!);
    return entry.promise;
  }

  async prepare(id: unknown): Promise<{ ok: boolean }> {
    if (this.disposed || !isYouTubeVideoId(id)) return { ok: false };
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

  async search(query: unknown): Promise<YouTubeSearchResponse> {
    if (this.disposed || typeof query !== 'string' || !query.trim() || query.length > 200)
      return { ok: false, error: 'invalid-query' };
    try {
      const results = await (await this.getYouTube()).search(query.trim(), { type: 'video' });
      return { ok: true, results: results.videos.filterType(YTNodes.Video).slice(0, 12).map(video => ({
        id: video.id, title: video.title.toString(), duration: video.duration?.seconds ?? 0,
      })) };
    } catch { return { ok: false, error: 'search-failed' }; }
  }

  private async createTokenWindow(): Promise<BrowserWindow> {
    // Adapted from GoogleVideo's MIT-licensed webpo-helper example.
    // Remote code runs in Chromium with no Node/preload/API bridge.
    const response = await fetchTimed('https://www.youtube.com', { headers: {
      'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.7',
    } });
    const html = await response.text();
    const configText = html.match(/ytcfg\.set\(({.+?})\);/s)?.[1];
    const challengeText = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1];
    if (!configText || !challengeText || this.disposed) throw new Error('challenge-unavailable');
    const challenge = parseLooseJSON(challengeText)?.R?.bgChallenge;
    if (!challenge) throw new Error('challenge-unavailable');
    const interpreterURL = new URL(challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue, 'https://www.youtube.com');
    if (interpreterURL.protocol !== 'https:' || !['www.google.com', 'www.gstatic.com', 'www.youtube.com'].includes(interpreterURL.hostname))
      throw new Error('invalid-interpreter');
    const interpreter = await (await fetchTimed(interpreterURL)).text();
    if (this.disposed) throw new Error('cancelled');
    const anonymous = session.fromPartition('youtube-music-anonymous');
    anonymous.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    anonymous.setPermissionCheckHandler(() => false);
    const tokenWindow = new BrowserWindow({ show: false, webPreferences: {
      session: anonymous, sandbox: true, nodeIntegration: false, contextIsolation: true,
      webSecurity: true, backgroundThrottling: false,
    } });
    this.tokenWindow = tokenWindow;
    tokenWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await tokenWindow.loadURL('https://www.youtube.com');
      const bundle = await fs.readFile(path.join(__dirname, 'youtube-token.js'), 'utf8');
      await tokenWindow.webContents.executeJavaScript(bundle);
      await tokenWindow.webContents.executeJavaScript(`window.yt = { config_: ${configText} };\n${interpreter}`);
      const snapshot = await tokenWindow.webContents.executeJavaScript(`(async () => { try {
        window.musicSignals = [];
        window.musicClient = await window.musicBotGuard.BotGuardClient.create({
          program: ${JSON.stringify(challenge.program)}, globalName: ${JSON.stringify(challenge.globalName)}, globalObject: window
        });
        return { value: await window.musicClient.snapshot({ webPoSignalOutput: window.musicSignals }) };
      } catch { return { error: true }; } })()`);
      if (snapshot.error) throw new Error('token-unavailable');
      const integrityResponse = await fetchTimed(buildURL('GenerateIT', true), {
        method: 'POST', headers: getHeaders(), body: JSON.stringify(['O43z0dpjhgX20SCx4KAo', snapshot.value]),
      });
      if (!integrityResponse.ok) throw new Error('token-unavailable');
      const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await integrityResponse.json();
      const tokenData = { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken };
      const success = await tokenWindow.webContents.executeJavaScript(`(async () => { try {
        window.musicMinter = await window.musicBotGuard.WebPoMinter.create(${JSON.stringify(tokenData)}, window.musicSignals);
        return true;
      } catch { return false; } })()`);
      if (!success || this.disposed) throw new Error('token-unavailable');
      this.tokenCreated = Date.now();
      return tokenWindow;
    } catch (error) {
      if (!tokenWindow.isDestroyed()) tokenWindow.destroy();
      this.tokenWindow = undefined;
      throw error;
    }
  }

  private async mintToken(id: string): Promise<string> {
    if (this.tokenWindow?.isDestroyed() || (this.tokenCreated && Date.now() - this.tokenCreated > 15 * 60 * 1000)) {
      this.tokenWindow?.destroy(); this.tokenReady = undefined;
    }
    this.tokenReady ??= this.createTokenWindow().catch(error => { this.tokenReady = undefined; throw error; });
    const tokenWindow = await this.tokenReady;
    return tokenWindow.webContents.executeJavaScript(`window.musicMinter.mintAsWebsafeString(${JSON.stringify(id)})`);
  }

  private ensureServer(): Promise<number> {
    if (this.disposed) return Promise.reject(new Error('cancelled'));
    this.serverReady ??= new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const stream = this.active;
        if (request.method !== 'GET' || !stream || request.url !== stream.path || stream.reader) {
          response.writeHead(404).end(); return;
        }
        response.writeHead(200, { 'Content-Type': stream.mimeType, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        stream.response = response;
        const reader = Readable.fromWeb(stream.audio as any);
        stream.reader = reader;
        reader.on('error', error => { console.warn('[youtube-music] audio-stream', error.message.slice(0, 180)); response.destroy(); });
        response.on('close', () => {
          reader.destroy();
          if (this.active === stream && !stream.finished) this.stop(stream.id);
        });
        reader.pipe(response);
      });
      this.server = server;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') resolve(address.port);
        else reject(new Error('server-unavailable'));
      });
    });
    return this.serverReady;
  }

  private async createAudio(id: string, cancelled: () => boolean): Promise<{ stream: ActiveStream; port: number }> {
    let sabr: SabrStream | undefined;
    try {
      const preparation = this.prepareTrack(id);
      const { info, token, url, port } = await preparation;
      if (cancelled()) throw new Error('cancelled');
      // SABR playback context belongs to one stream. Reusing it for a restart can
      // return an initialization segment followed by no further media parts.
      if (this.prepared.get(id)?.promise === preparation) this.prepared.delete(id);
      sabr = new SabrStream({
        serverAbrStreamingUrl: url,
        videoPlaybackUstreamerConfig: info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config,
        formats: info.streaming_data!.adaptive_formats.map(buildSabrFormat), poToken: token,
        clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS.WEB), clientVersion: Constants.CLIENTS.WEB.VERSION },
        fetch: async (input, init) => {
          // Avoid a hot request loop if the server supplies no additional media.
          await new Promise(resolve => setTimeout(resolve, 200));
          // Bound stalled reads, not the lifetime of a playing audio response.
          return fetchMusicStream(input, init);
        },
      });
      const completion: { finished: boolean; stream?: ActiveStream } = { finished: false };
      sabr.on('finish', () => { completion.finished = true; if (completion.stream) completion.stream.finished = true; });
      const { audioStream, selectedFormats } = await sabr.start({
        enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY, preferWebM: true, preferOpus: true,
        maxRetries: 2, stallDetectionMs: 15000,
      });
      if (cancelled()) throw new Error('cancelled');
      const streamId = randomBytes(24).toString('hex');
      const stream: ActiveStream = { id: streamId, path: `/audio/${streamId}`, audio: audioStream, videoId: id,
        mimeType: selectedFormats.audioFormat.mimeType!, sabr, finished: completion.finished };
      completion.stream = stream;
      return { stream, port };
    } catch (error) {
      try { sabr?.abort(); } catch { /* Completed streams may already be closed. */ }
      throw error;
    }
  }

  async play(id: unknown): Promise<YouTubePlayResponse> {
    if (this.disposed || !isYouTubeVideoId(id)) return { ok: false, error: 'invalid-video' };
    this.stop();
    const generation = this.generation;
    const cancelled = () => generation !== this.generation || this.disposed;
    try {
      const source = await this.createAudio(id, cancelled);
      if (cancelled()) {
        try { source.stream.sabr.abort(); } catch { /* Already closed. */ }
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
    stream?.reader?.destroy(); stream?.response?.destroy();
    if (stream) { try { stream.sabr.abort(); } catch { /* Already closed. */ } }
  }

  dispose(): void {
    this.disposed = true;
    this.prepared.clear();
    this.stop();
    if (this.tokenWindow && !this.tokenWindow.isDestroyed()) this.tokenWindow.destroy();
    this.tokenWindow = undefined;
    this.server?.closeAllConnections(); this.server?.close();
  }
}

