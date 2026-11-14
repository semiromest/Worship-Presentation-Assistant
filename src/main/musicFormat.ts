/** İndirilen müzik için hedef üst sınır: Opus bu bit hızında arka plan müziğinde duyulur kayıp vermez. */
export const OFFLINE_AUDIO_MAX_BITRATE = 100_000;

export interface AudioFormatLike {
  mimeType?: string;
  bitrate?: number;
  averageBitrate?: number;
  isDrc?: boolean;
  isDubbed?: boolean;
  isAutoDubbed?: boolean;
  isDescriptive?: boolean;
}

const rate = (format: AudioFormatLike) => format.averageBitrate || format.bitrate || 0;

/**
 * Çevrimdışı kopya için sıkıştırılmış ses biçimi seçer (yeniden kodlama yok, CPU maliyeti yok):
 * özgün parça, DRC'siz, tercihen Opus; sınırın altındaki en yüksek bit hızı, yoksa en düşüğü.
 * Uygun biçim yoksa `undefined` döner; çağıran varsayılan seçime düşer.
 */
export function chooseCompactAudioFormat<T extends AudioFormatLike>(formats: readonly T[], maxBitrate = OFFLINE_AUDIO_MAX_BITRATE): T | undefined {
  const narrow = (list: T[], keep: (format: T) => boolean) => {
    const kept = list.filter(keep);
    return kept.length ? kept : list;
  };
  let pool = formats.filter(format => /^audio\/(webm|mp4)/.test(format.mimeType ?? '') && rate(format) > 0);
  pool = narrow(pool, format => !format.isDubbed && !format.isAutoDubbed && !format.isDescriptive);
  pool = narrow(pool, format => !format.isDrc);
  pool = narrow(pool, format => !!format.mimeType?.includes('opus'));
  if (!pool.length) return undefined;
  const sorted = [...pool].sort((a, b) => rate(b) - rate(a));
  return sorted.find(format => rate(format) <= maxBitrate) ?? sorted[sorted.length - 1];
}
