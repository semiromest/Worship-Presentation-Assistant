export interface WorshipSong {
  id: number;
  title: string;
  songkey: string | null;
  song_usage_2m: number;
}

export interface WorshipSongDetail {
  id: number;
  title: string;
  songxml: string;
}

interface ListSongsResponse {
  success: boolean;
  data: {
    id: number;
    title: string;
    songkey?: string | null;
    song_usage_2m?: number;
  }[];
  total: number;
}

interface GetSongResponse {
  success: boolean;
  data: {
    id: number;
    title: string;
    songxml?: string;
  };
}

const BASE_URL = 'https://songs.worshipleaderapp.com';

export async function listSongs(
  lang: string,
  start: number,
  limit: number
): Promise<{ songs: WorshipSong[]; total: number }> {
  const params = new URLSearchParams({
    start: String(start),
    limit: String(limit),
    filters: JSON.stringify({ lang }),
  });
  const res = await fetch(`${BASE_URL}/api/grid?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const json: ListSongsResponse = await res.json();
  if (!json.success) throw new Error('API returned unsuccessful');
  return {
    songs: json.data.map((d) => ({
      id: d.id,
      title: d.title,
      songkey: d.songkey ?? null,
      song_usage_2m: d.song_usage_2m ?? 0,
    })),
    total: json.total,
  };
}

export async function getSong(id: number): Promise<WorshipSongDetail> {
  const res = await fetch(`${BASE_URL}/api/get?id=${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const json: GetSongResponse = await res.json();
  if (!json.success || !json.data) throw new Error('Song not found');
  return {
    id: json.data.id,
    title: json.data.title,
    songxml: json.data.songxml ?? '',
  };
}

// Kıta (stanza) sınırı sayılan blok etiketleri: açılış/kapanış → \n\n
const RE_BLOCK_TAGS = /<\s*\/?\s*(?:verse|chorus|refrain|bridge|stanza|paragraph|para|section|part|repeat|intro|outro|tag|interlude)\b[^>]*\s*>/gi;

export function parseSongXml(songxml: string): string {
  if (!songxml) return '';
  let text = songxml;
  // Akorlar tamamen kaldırılır
  text = text.replace(/<chord>[^<]*<\/chord>/g, '');
  // Blok etiketleri kıta boşluğuna çevrilir (stanza yapısı korunur)
  text = text.replace(RE_BLOCK_TAGS, '\n\n');
  // Satır sonu etiketleri → yeni satır (ardındaki boşluk/\/n ile birlikte)
  text = text.replace(/<br\s*\/?>\s*/gi, '\n');
  // Kalan satır içi etiketler → boşluk
  text = text.replace(/<[^>]+>/g, ' ');
  // HTML varlıkları
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // Normalizasyon
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/[^\S\n]+$/gm, '');
  text = text.replace(/^[^\S\n]+/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ─── Set (liste) linki çözümleme ────────────────────────────────────────────
//
// Worship Leader uygulamasında setler cihaz yerelinde tutulur; sunucuda
// "set_id ile set getir" API'si yoktur. Paylaşılan set linkleri şarkı
// id'lerini URL'e gömer:
//
//   https://songs.worshipleaderapp.com/#page-set-list?new_set=Hafta+1&song_ids=568,208,...&keys=...&capos=...
//
// Kendi cihazında görüntülenen set view linki ise yalnızca yerel bir id taşır:
//
//   https://songs.worshipleaderapp.com/#page-set-view?set_id=10
//
// Bu fonksiyon her iki biçimi de çözer. "songs" türü doğrudan içe
// aktarılabilir; "set_id" türü yalnızca yerel bir id olduğu için
// kullanıcıya açıklayıcı bir mesaj gösterilmesini sağlar.

export type SetLinkKind = 'songs' | 'set_id' | 'none';

export interface SetLinkInfo {
  kind: SetLinkKind;
  songIds: number[];
  setTitle: string | null;
  setLocalId: number | null;
}

export function parseSetLink(url: string): SetLinkInfo {
  if (!url || typeof url !== 'string') {
    return { kind: 'none', songIds: [], setTitle: null, setLocalId: null };
  }

  const trimmed = url.trim();
  const hashIdx = trimmed.indexOf('#');
  const queryPart = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : trimmed;

  let params: URLSearchParams;
  try {
    const questionIdx = queryPart.indexOf('?');
    params = new URLSearchParams(questionIdx >= 0 ? queryPart.slice(questionIdx + 1) : queryPart);
  } catch {
    return { kind: 'none', songIds: [], setTitle: null, setLocalId: null };
  }

  const title = params.get('new_set') || params.get('set_title');
  const rawIds = params.get('song_ids');
  const rawSetId = params.get('set_id');

  const songIds = (rawIds ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (songIds.length > 0) {
    return { kind: 'songs', songIds, setTitle: title || null, setLocalId: null };
  }

  if (rawSetId) {
    const parsed = parseInt(rawSetId, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { kind: 'set_id', songIds: [], setTitle: title || null, setLocalId: parsed };
    }
  }

  return { kind: 'none', songIds: [], setTitle: title || null, setLocalId: null };
}

/**
 * Şarkı id listesini sıralı biçimde çeker. `onProgress` her tamamlanan
 * şarkıda (fetched, total) ile çağrılır; başarısız id'ler atlanır.
 */
export async function fetchSongsByIds(
  ids: number[],
  onProgress?: (fetched: number, total: number) => void
): Promise<WorshipSongDetail[]> {
  const results: WorshipSongDetail[] = [];
  let done = 0;
  for (const id of ids) {
    try {
      results.push(await getSong(id));
    } catch (e) {
      console.error(`Failed to fetch song #${id}`, e);
    }
    done += 1;
    onProgress?.(done, ids.length);
  }
  return results;
}
