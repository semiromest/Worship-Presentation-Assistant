/** 1080p JPEG'in base64 hali bile bunun çok altındadır; aşırı büyük veri yayına alınmaz. */
export const MAX_FRAME_CHARS = 8 * 1024 * 1024;

const IMAGE_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,/;

/**
 * The renderer hands over a data URL; phones receive the raw image bytes as a binary
 * WebSocket message. Decoding once here saves ~25% of every frame on the church Wi-Fi
 * and spares each phone a JSON parse plus base64 decode of a large string.
 */
export function decodeFrame(frame: unknown): Buffer | null {
  if (typeof frame !== 'string' || !frame || frame.length > MAX_FRAME_CHARS) return null;
  const header = IMAGE_DATA_URL_RE.exec(frame);
  if (!header) return null;
  const bytes = Buffer.from(frame.slice(header[0].length), 'base64');
  return bytes.length ? bytes : null;
}
