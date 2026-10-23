import { isYouTubeMusicResult, isYouTubeVideoId, type YouTubeMusicResult, type YouTubeSearchResponse } from '../shared/youtubeMusic';

export type MusicQuery =
  | { kind: 'text'; query: string }
  | { kind: 'video'; id: string }
  | { kind: 'invalid' };

type SearchFn = (text: string, cursor?: unknown) => Promise<YouTubeSearchResponse>;
type VideoFn = (id: string) => Promise<YouTubeMusicResult>;

const MAX_URL_LENGTH = 2048;
// Regex'ler ve host listeleri modül seviyesinde bir kez oluşur, her çağrıda yeniden kurulmaz.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_YOUTUBE_RE = /^(?:(?:www\.|m\.|music\.)?youtube\.com|youtu\.be)(?:[/:]|$)/i;
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const PATH_ID_PREFIXES: ReadonlySet<string> = new Set(['shorts', 'live', 'embed']);

/** Geçerli bir URL için video id'sini, aksi halde null döndürür. */
function extractVideoId(url: URL): string | null {
  // WHATWG URL, http(s) host'larını zaten küçük harfe çevirir; toLowerCase gerekmez.
  const { hostname } = url;
  const isShortHost = hostname === 'youtu.be';
  if (!isShortHost && !YOUTUBE_HOSTS.has(hostname)) return null;

  const pieces = url.pathname.split('/').filter(Boolean);
  if (isShortHost) return pieces.length === 1 ? pieces[0] : null;
  if (pieces.length === 1 && pieces[0] === 'watch') return url.searchParams.get('v');
  if (pieces.length === 2 && PATH_ID_PREFIXES.has(pieces[0])) return pieces[1];
  return null;
}

export function parseMusicQuery(input: string): MusicQuery {
  const text = input.trim();
  const hasScheme = SCHEME_RE.test(text); // Sonuç hem URL tespitinde hem de URL kurarken kullanılıyor.
  if (!hasScheme && !BARE_YOUTUBE_RE.test(text)) return { kind: 'text', query: text };
  if (text.length > MAX_URL_LENGTH) return { kind: 'invalid' };

  try {
    const url = new URL(hasScheme ? text : `https://${text}`);
    const { protocol } = url;
    if ((protocol !== 'http:' && protocol !== 'https:') || url.username || url.password || url.port) {
      return { kind: 'invalid' };
    }
    const id = extractVideoId(url);
    return isYouTubeVideoId(id) ? { kind: 'video', id } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

export async function lookupMusicQuery(
  query: unknown,
  cursor: unknown,
  search: SearchFn,
  video: VideoFn,
): Promise<YouTubeSearchResponse> {
  if (typeof query !== 'string' || !query.trim()) return { ok: false, error: 'invalid-query' };

  const parsed = parseMusicQuery(query);
  if (parsed.kind === 'invalid') return { ok: false, error: 'invalid-link' };
  if (parsed.kind === 'text') return search(parsed.query, cursor);
  // Tek video sonucunun sayfalaması yok; cursor gelmişse arama süresi dolmuştur.
  if (cursor !== undefined) return { ok: false, error: 'search-expired' };

  try {
    const result = await video(parsed.id);
    if (!isYouTubeMusicResult(result) || result.id !== parsed.id) return { ok: false, error: 'video-unavailable' };
    return { ok: true, results: [result] };
  } catch {
    return { ok: false, error: 'video-unavailable' };
  }
}