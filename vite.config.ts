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
            target: 'node20',         // ✅ Main process Node.js tabanlı çalışır
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

      preload: {
        input: path.join(__dirname, 'src/main/preload.ts'),
        vite: {
          build: {
            target: 'node20',         // ✅ Preload da Node.js ortamında çalışır
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

  // ✅ manualChunks buraya taşındı — renderer (Chromium) tarafına ait
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