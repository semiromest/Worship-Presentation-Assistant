import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Renderer only: the Electron fixture owns startup and isolated userData.
// A test run uses one stable module graph; source edits require a new run.
export default defineConfig({ server: { watch: null, hmr: false }, plugins: [react()], define: { 'import.meta.env.VITE_TOUR_E2E': JSON.stringify('1') } });
