import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Renderer only: the Electron fixture owns startup and isolated userData.
export default defineConfig({ plugins: [react()], define: { 'import.meta.env.VITE_TOUR_E2E': JSON.stringify('1') } });
