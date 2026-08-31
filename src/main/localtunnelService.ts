export type TunnelState = 'stopped' | 'connecting' | 'ready' | 'reconnecting' | 'error';
export type LocalTunnelStatus = { active: boolean; url: string; state: TunnelState; error?: string };
export type TunnelStatusListener = (status: LocalTunnelStatus) => void;

const unavailableStatus: LocalTunnelStatus = {
  active: false,
  url: '',
  state: 'error',
  error: 'Public tunnel provider is not configured',
};
let status: LocalTunnelStatus = { ...unavailableStatus };
let listener: TunnelStatusListener | null = null;

export function setTunnelStatusListener(next: TunnelStatusListener | null): void {
  listener = next;
}

function publish(next: LocalTunnelStatus): void {
  status = next;
  listener?.(next);
}

export async function startPublicTunnel(_port: number, _domain?: string): Promise<LocalTunnelStatus> {
  publish({ ...unavailableStatus });
  return status;
}

export async function stopPublicTunnel(): Promise<LocalTunnelStatus> {
  publish({ active: false, url: '', state: 'stopped' });
  return status;
}

export function getPublicTunnelStatus(): LocalTunnelStatus {
  return status;
}

export function disposePublicTunnel(): void {
  publish({ active: false, url: '', state: 'stopped' });
}
