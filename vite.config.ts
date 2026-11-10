import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { build as bundleBrowser } from 'esbuild';

export default defineConfig(({ command }) => ({
  server: {
    host: '127.0.0.1',
  },
  plugins: [
    react(),
    {
      // Dev needs 'unsafe-inline' (React Refresh preamble) and 'unsafe-eval' (HMR);
      // the production bundle has neither inline scripts nor eval, so ship a strict script-src.
      name: 'strict-production-csp',
      apply: 'build',
      transformIndexHtml(html) {
        const strict = html.replace(/script-src 'self' 'unsafe-inline' 'unsafe-eval';/, "script-src 'self';");
        if (strict === html) throw new Error('strict-production-csp: script-src directive not found in index.html');
        return strict;
      },
    },
    electron({
      main: {
        entry: 'src/main/main.ts',
        vite: {
          plugins: [{
            name: 'youtube-token-browser',
            async buildStart() {
              const result = await bundleBrowser({
                entryPoints: [path.join(__dirname, 'src/main/youtubeTokenBrowser.ts')],
                bundle: true, format: 'iife', platform: 'browser', minify: true, write: false,
              });
              this.emitFile({ type: 'asset', fileName: 'youtube-token.js', source: result.outputFiles[0].text });
            },
          }],
          build: {
            // Main and preload share dist-electron. A main-only watch rebuild
            // must not delete preload.js and leave the restarted app blank.
            // The production build script already clears the output upfront.
            emptyOutDir: false,
            target: 'node20',         // main process runs on Node.js
            minify: 'esbuild',
            sourcemap: false,
            rollupOptions: {
              external: [
                'electron',
                '@napi-rs/canvas',
              ],
              // Phase 7: second entry — the heavy-work UtilityProcess. Input
              // overrides the single lib entry (see vite-plugin-electron docs).
              input: {
                main: path.join(__dirname, 'src/main/main.ts'),
                heavyWorker: path.join(__dirname, 'src/main/utility/heavyWorker.ts'),
                pptxImportWorker: path.join(__dirname, 'src/main/utility/pptxImportWorker.ts'),
                gradientWorker: path.join(__dirname, 'src/main/utility/gradientWorker.ts'),
              },
              output: { entryFileNames: '[name].js' },
            },
          },
        },
      },

      preload: {
        input: path.join(__dirname, 'src/main/preload.ts'),
        vite: {
          build: {
            emptyOutDir: false,
            target: 'node20',         // preload runs in a Node.js environment
            minify: 'esbuild',
            sourcemap: false,
            rollupOptions: {
              external: [
                'electron',
              ],
            },
          },
        },
      },

      renderer: {},
    }),
  ],

  // Renderer production build only (dev keeps every console call; the Electron main/preload
  // builds use their own inline config). Chatty logs are removed, warnings and errors stay
  // so field diagnostics keep working. `esbuild` is a top-level option — under `build` it is ignored.
  esbuild: command === 'build' ? { pure: ['console.log', 'console.info', 'console.debug'], drop: ['debugger'] } : undefined,

  build: {
    target: 'chrome120',
    cssCodeSplit: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Function form: only modules the renderer really imports are grouped. The old object
        // form created an empty `google` chunk and a `pptx` chunk that captured Vite's preload
        // helper, which made every window modulepreload it at startup.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor';
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return 'lucide';
          if (/node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector)[\\/]/.test(id)) return 'i18n';
          return undefined;
        },
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
