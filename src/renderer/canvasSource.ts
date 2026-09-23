// ─── Canvas-safe media sources ──────────────────────────────────────────────
// Slide media is drawn into a <canvas> to build the phone/remote previews. Such
// a canvas stays exportable only while EVERY image was fetched in CORS mode:
// `local-resource://` (the app's own media protocol) and `file://` are a
// different origin than the renderer, so drawing them without `crossOrigin`
// silently taints the canvas and the later toDataURL() throws SecurityError.
//
// Because loadImage only asked for CORS on http(s) URLs, every image slide
// restored from a saved/Drive presentation — those reference
// `local-resource://media/<hash>` (Phase 6 media library) instead of the
// original path — rendered fine on screen (<img> needs no CORS) but could never
// be exported, so the phone grid stayed on "LOADING" forever.
//
// Pure module (no DOM/React): the caller decides whether the Electron media
// protocol is available, so this stays unit-testable in node.

/** Ref form the main process's Range-capable media protocol serves. */
export const MEDIAFILE_REF_PREFIX = 'local-resource://mediafile/';

const HTTP_RE = /^https?:\/\//i;
const WINDOWS_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_ROOTED_PATH_RE = /^\/[a-zA-Z]:\//;

/** file:// URL or absolute OS path → plain OS path, otherwise null. */
export function toOsPath(src: string): string | null {
  if (src.startsWith('file://')) {
    try {
      let p = decodeURIComponent(new URL(src).pathname);
      if (WINDOWS_ROOTED_PATH_RE.test(p)) p = p.slice(1); // Windows: /C:/x → C:/x
      return p;
    } catch {
      return null;
    }
  }
  return WINDOWS_PATH_RE.test(src) || src.startsWith('/') ? src : null;
}

/** URL that streams an OS path through the app's CORS-enabled media protocol. */
export function toMediaStreamUrl(osPath: string): string {
  return `${MEDIAFILE_REF_PREFIX}${encodeURIComponent(osPath.replace(/\\/g, '/'))}`;
}

/** Default Electron detection (overridable so tests stay DOM-free). */
function hasElectronApi(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

/**
 * Resolves a media URL into something safely drawable on a canvas, together
 * with whether the browser must request it in CORS mode.
 */
export function resolveCanvasSource(
  src: string,
  applyCors: boolean,
  electronAvailable: boolean = hasElectronApi(),
): { url: string; cors: boolean } {
  // Inline/object URLs carry their own origin — never taint the canvas.
  if (src.startsWith('data:') || src.startsWith('blob:')) return { url: src, cors: false };
  // The app's own protocol answers with `Access-Control-Allow-Origin: *`, but
  // only a CORS-mode request is allowed to export it later.
  if (src.startsWith('local-resource://')) return { url: src, cors: true };
  if (HTTP_RE.test(src)) return { url: src, cors: applyCors };
  // A file path is only reliably readable through the media protocol: it works
  // from both the dev (http) and packaged (file://) renderer origins and is
  // CORS-enabled.
  const osPath = toOsPath(src);
  if (osPath && electronAvailable) return { url: toMediaStreamUrl(osPath), cors: true };
  return { url: src, cors: false };
}
