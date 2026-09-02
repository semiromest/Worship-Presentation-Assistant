import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/main.ts',
        vite: {
          build: {
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

  // manualChunks moved here — belongs to the renderer (Chromium)
  build: {
    target: 'chrome120',
    cssCodeSplit: true,
    minify: 'esbuild',
    sourcemap: false,
    // Drop console.* and debugger statements in production builds
    esbuild: {
      drop: ['console', 'debugger'],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          lucide: ['lucide-react'],
          pptx: ['pptxgenjs'],
          google: ['@googleapis/drive', 'google-auth-library'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});