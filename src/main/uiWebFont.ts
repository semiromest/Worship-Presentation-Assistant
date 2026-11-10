// Fonts for the HTML pages the app serves to phones/browsers (remote control,
// live captions share, live screen share). They come from the bundled, OFL-licensed
// resources/fonts folder, so the pages render identically on an offline LAN.

/** Public route → file inside resources/fonts. Only these exact paths are served. */
export const UI_WEB_FONT_FILES: Readonly<Record<string, string>> = {
  '/fonts/ui.ttf': 'atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext[wght].ttf',
  '/fonts/ui-italic.ttf': 'atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext-Italic[wght].ttf',
  '/fonts/mono.ttf': 'spacemono/SpaceMono-Regular.ttf',
  '/fonts/mono-bold.ttf': 'spacemono/SpaceMono-Bold.ttf',
};

/** Same UI typeface as the desktop control panel (src/renderer/index.css). */
export const UI_WEB_FONT_STACK = `'WPA UI', system-ui, -apple-system, 'Segoe UI', sans-serif`;
export const UI_WEB_MONO_STACK = `'WPA Mono', ui-monospace, monospace`;

export const UI_WEB_FONT_CSS = [
  `@font-face{font-family:'WPA UI';font-style:normal;font-weight:200 800;font-display:swap;src:url('/fonts/ui.ttf') format('truetype')}`,
  `@font-face{font-family:'WPA UI';font-style:italic;font-weight:200 800;font-display:swap;src:url('/fonts/ui-italic.ttf') format('truetype')}`,
  `@font-face{font-family:'WPA Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/fonts/mono.ttf') format('truetype')}`,
  `@font-face{font-family:'WPA Mono';font-style:normal;font-weight:700;font-display:swap;src:url('/fonts/mono-bold.ttf') format('truetype')}`,
].join('\n');

export function uiWebFontFile(pathname: string): string | null {
  return Object.prototype.hasOwnProperty.call(UI_WEB_FONT_FILES, pathname) ? UI_WEB_FONT_FILES[pathname] : null;
}
