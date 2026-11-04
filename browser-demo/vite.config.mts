import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(root, '../src/renderer');
const runtime = path.join(root, 'runtime.ts');
const aliases = new Map([
  ...['hooks/useStt', 'state/useRemoteControl', 'hooks/useProjectorSync', 'hooks/useLiveScreenShare', 'hooks/useScreenShare', 'hooks/useShare', 'hooks/usePreparationCheck', 'hooks/useSttSlideTracker', 'components/DesktopHost'].map(name => [path.join(renderer, name).toLowerCase(), runtime]),
  [path.join(renderer, 'hooks/useLiveSave').toLowerCase(), path.join(root, 'liveSave.ts')],
]);
export default defineConfig({
  root, base: './', publicDir: false,
  plugins: [
    { name: 'browser-demo-runtime', enforce: 'pre', resolveId(id, importer) {
      if (!importer || !id.startsWith('.') || id.includes('?browser-original')) return;
      const target = path.resolve(path.dirname(importer.split('?')[0]), id).replace(/\.(tsx?|jsx?)$/, '').toLowerCase();
      return aliases.get(target);
    }, transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/renderer/MediaLoopTab.tsx')) return;
      // Desktop file protocols are replaced only in the browser bundle; all UI is retained.
      return code
        .replace('const toFileUrl = (p: string) => {', 'const toFileUrl = (p: string) => { if (/^(blob:|data:)/.test(p)) return p;')
        .replace('const toMediaStreamUrl = (p: string) => `local-resource://mediafile/${encodeURIComponent(normalizePath(p))}`;', 'const toMediaStreamUrl = (p: string) => /^(blob:|data:)/.test(p) ? p : `local-resource://mediafile/${encodeURIComponent(normalizePath(p))}`;')
        .replace("const getFileName = (p: string) => normalizePath(p).split('/').pop() ?? 'Untitled';", "const getFileName = (p: string) => p.startsWith('blob:') && p.includes('#') ? decodeURIComponent(p.split('#').slice(1).join('#')) : normalizePath(p).split('/').pop() ?? 'Untitled';");
    } },
    react(),
  ],
  server: { host: '127.0.0.1', port: 4175, strictPort: true, fs: { allow: [path.resolve(root, '..')] } },
  build: { outDir: path.resolve(root, '../site/demo'), emptyOutDir: true, target: 'es2022', sourcemap: false },
});
