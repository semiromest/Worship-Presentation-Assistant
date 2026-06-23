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

export function parseSongXml(songxml: string): string {
  if (!songxml) return '';
  let text = songxml;
  // Remove <chord> tags completely (content included)
  text = text.replace(/<chord>[^<]*<\/chord>/g, '');
  // Strip ALL remaining XML tags (generic approach)
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text;
}
