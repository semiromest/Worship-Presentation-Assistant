import { fileURLToPath } from 'node:url';

// A separate config keeps website previews independent of the Electron plugins.
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
};
