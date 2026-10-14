import { encodeGradient } from '../gradientRender';
import type { GeneratedBackground } from '../../shared/generatedBackground';
import type { ContrastRegion } from '../../shared/gradientContrast';
const port = (
  process as unknown as {
    parentPort: {
      on: (
        event: string,
        fn: (event: { data: { recipe: GeneratedBackground; regions: ContrastRegion[] } }) => void
      ) => void;
      postMessage: (value: unknown) => void;
    };
  }
).parentPort;
port.on('message', ({ data }) => {
  try {
    port.postMessage({ ok: true, result: encodeGradient(data.recipe, data.regions) });
  } catch {
    port.postMessage({ ok: false });
  }
});
