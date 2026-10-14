import { ipcMain, utilityProcess, type WebContents } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGradient } from '../shared/generatedBackground';
import type { ContrastRegion } from '../shared/gradientContrast';
import type { MediaLibrary } from './mediaLibrary';
import type { encodeGradient } from './gradientRender';
type Rendered = ReturnType<typeof encodeGradient>;

/** One bounded, memory-only draft and one isolated generator per renderer. */
export function registerGradientService(library: MediaLibrary) {
  const sessions = new Map<number, { token?: string; bytes?: Buffer; cancel?: () => void }>();
  const owners = new WeakSet<WebContents>();
  ipcMain.handle('gradient:generate', async (event, input: unknown, regionsInput: unknown) => {
    const recipe = validateGradient(input);
    if (
      !Array.isArray(regionsInput) ||
      regionsInput.length > 500 ||
      !regionsInput.every(
        (r: ContrastRegion) =>
          r &&
          [r.x, r.y, r.width, r.height].every((v) => Number.isFinite(v) && Math.abs(v) <= 10000) &&
          r.width >= 0 &&
          r.height >= 0 &&
          Array.isArray(r.color) &&
          r.color.length === 3 &&
          r.color.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
      )
    )
      throw new Error('Invalid text regions');
    const owner = event.sender;
    sessions.get(owner.id)?.cancel?.();
    const state: { token?: string; bytes?: Buffer; cancel?: () => void } = {};
    sessions.set(owner.id, state);
    if (!owners.has(owner)) {
      owners.add(owner);
      owner.once('destroyed', () => {
        sessions.get(owner.id)?.cancel?.();
        sessions.delete(owner.id);
      });
    }
    const result = await new Promise<Rendered>((resolve, reject) => {
      const worker = utilityProcess.fork(path.join(__dirname, 'gradientWorker.js'), [], {
        serviceName: 'presenter-gradient',
      });
      let done = false;
      const finish = (error?: Error, result?: Rendered) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        worker.kill();
        state.cancel = undefined;
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(() => finish(new Error('Gradient timed out')), 30000);
      state.cancel = () => finish(new Error('Gradient cancelled'));
      worker.once('exit', () => finish(new Error('Gradient worker exited')));
      worker.once('message', (message: { ok: boolean; result?: Rendered }) =>
        message.ok && message.result ? finish(undefined, message.result) : finish(new Error('Gradient failed'))
      );
      worker.postMessage({ recipe, regions: regionsInput });
    });
    if (sessions.get(owner.id) !== state || owner.isDestroyed()) throw new Error('Stale gradient');
    const bytes = Buffer.from(result.bytes);
    if (bytes.length > 500 * 1024) throw new Error('Gradient exceeds image budget');
    state.token = randomUUID();
    state.bytes = bytes;
    return {
      token: state.token,
      image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      recipe,
      contrast: result.contrast,
      byteLength: bytes.length,
      hash: result.jpegHash,
    };
  });
  ipcMain.handle('gradient:discard', (event) => {
    sessions.get(event.sender.id)?.cancel?.();
    sessions.delete(event.sender.id);
  });
  ipcMain.handle('gradient:save', async (event, token: unknown) => {
    const draft = sessions.get(event.sender.id);
    if (typeof token !== 'string' || !draft?.bytes || draft.token !== token) throw new Error('Gradient draft expired');
    const ref = await library.storeBytes(draft.bytes, 'jpg');
    if (!ref) throw new Error('Gradient could not be saved');
    return ref;
  });
}
