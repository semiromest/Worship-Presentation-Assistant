import { parseGetBibleJson } from './getBibleModel';

interface WorkerRequest {
  text: string;
}

type WorkerResponse = { ok: true; bible: ReturnType<typeof parseGetBibleJson> } | { ok: false; error: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({ ok: true, bible: parseGetBibleJson(event.data.text) });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
