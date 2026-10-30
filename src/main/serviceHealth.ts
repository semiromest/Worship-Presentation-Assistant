let observer: (name: string, ok: boolean) => void = () => {};
export const reportServiceHealth = (name: string, ok: boolean) => observer(name, ok);
export function observeServiceHealth(callback: typeof observer) { observer = callback; }
export async function serviceRequest<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    observer(name, !(result && typeof result === 'object' && 'ok' in result && result.ok === false));
    return result;
  } catch (error) { observer(name, false); throw error; }
}
