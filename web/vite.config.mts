import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(root, '../src/renderer');
const runtime = path.join(root, 'runtime.ts');
// Only hooks whose work lives in the Electron main process are replaced; the rest is the real renderer.
const aliases = new Map(
  ['hooks/useStt', 'hooks/useSttSlideTracker', 'hooks/useLiveScreenShare', 'hooks/useScreenShare', 'hooks/useShare', 'components/DesktopHost']
    .map(name => [path.join(renderer, name).toLowerCase(), runtime]),
);

const URL_SCHEME = String.raw`/^(blob:|data:|https?:)/`;
/** Desktop media helpers assume file-system paths; web media are same-origin URLs. */
const patches: Record<string, [string, string][]> = {
  '/src/renderer/MediaLoopTab.tsx': [
    ['const toFileUrl = (p: string) => {', `const toFileUrl = (p: string) => { if (${URL_SCHEME}.test(p)) return p;`],
    ['const toMediaStreamUrl = (p: string) => `local-resource://mediafile/${encodeURIComponent(normalizePath(p))}`;',
      `const toMediaStreamUrl = (p: string) => ${URL_SCHEME}.test(p) ? p : \`local-resource://mediafile/\${encodeURIComponent(normalizePath(p))}\`;`],
    ["const getFileName = (p: string) => normalizePath(p).split('/').pop() ?? 'Untitled';",
      `const getFileName = (p: string) => ${URL_SCHEME}.test(p) && p.includes('#') ? decodeURIComponent(p.split('#').slice(1).join('#')) : normalizePath(p).split('/').pop() ?? 'Untitled';`],
  ],
  '/src/renderer/editor/panels/SlideSettingsPanel.tsx': [
    ["onChange({ backgroundImage: `file://${file.replace(/\\\\/g, '/')}` });",
      `onChange({ backgroundImage: ${URL_SCHEME}.test(file) ? file : \`file://\${file.replace(/\\\\/g, '/')}\` });`],
  ],
  '/src/renderer/editor/SlideEditor.tsx': [
    ["replaceImage(target, 'file://' + file.replace(/\\\\/g, '/'))",
      `replaceImage(target, ${URL_SCHEME}.test(file) ? file : 'file://' + file.replace(/\\\\/g, '/'))`],
  ],
};

function webRuntime(): Plugin {
  return {
    name: 'web-runtime',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer || !id.startsWith('.')) return;
      const target = path.resolve(path.dirname(importer.split('?')[0]), id).replace(/\.(tsx?|jsx?)$/, '').toLowerCase();
      return aliases.get(target);
    },
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/');
      const entry = Object.entries(patches).find(([suffix]) => file.endsWith(suffix));
      if (!entry) return;
      let next = code;
      for (const [from, to] of entry[1]) {
        if (!next.includes(from)) this.error(`web build patch no longer matches ${entry[0]}: ${from.slice(0, 60)}…`);
        next = next.replace(from, to);
      }
      return next;
    },
  };
}

/**
 * Emits sw.js with the list of every file of the build, so the installed app works offline
 * (web/sw.js is the template). The dev server serves it with an empty list: no caching in dev.
 */
function serviceWorker(): Plugin {
  const template = () => fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const render = (files: string[]) => {
    const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16);
    return template().replace('__PRECACHE__', JSON.stringify({ version: files.length ? version : 'dev', files }));
  };
  const publicFiles = fs.readdirSync(path.join(root, 'public'));
  return {
    name: 'web-service-worker',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(render([]));
      });
    },
    generateBundle(_options, bundle) {
      const files = [...new Set(['./', 'index.html', ...publicFiles, ...Object.keys(bundle)])]
        .filter(file => !file.endsWith('.map') && file !== 'sw.js')
        .sort();
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: render(files) });
    },
  };
}

export default defineConfig({
  root,
  base: './',
  publicDir: path.join(root, 'public'),
  plugins: [webRuntime(), react(), { ...serviceWorker(), enforce: 'post' }],
  server: { host: '127.0.0.1', port: 4176, strictPort: true, fs: { allow: [path.resolve(root, '..')] } },
  preview: { host: '127.0.0.1', port: 4177, strictPort: true },
  build: { outDir: path.resolve(root, '../site/app'), emptyOutDir: true, target: 'es2022', sourcemap: false },
});
