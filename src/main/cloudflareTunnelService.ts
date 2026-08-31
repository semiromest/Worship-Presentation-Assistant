import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type TunnelState = 'stopped' | 'connecting' | 'ready' | 'error';
export type PublicTunnelStatus = { active: boolean; url: string; state: TunnelState; error?: string };
export type TunnelStatusListener = (status: PublicTunnelStatus) => void;

const stoppedStatus: PublicTunnelStatus = { active: false, url: '', state: 'stopped' };
let status: PublicTunnelStatus = stoppedStatus;
let listener: TunnelStatusListener | null = null;
let processRef: ChildProcess | null = null;
let startPromise: Promise<PublicTunnelStatus> | null = null;
let output = '';

export function setPublicTunnelStatusListener(next: TunnelStatusListener | null): void { listener = next; }
function publish(next: PublicTunnelStatus): void { status = next; listener?.(next); }

function executableName(): string { return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'; }
function executablePath(): string {
  const bundled = path.join(process.resourcesPath, 'cloudflared', executableName());
  if (app.isPackaged) return bundled;
  return path.join(app.getAppPath(), 'resources', 'cloudflared', executableName());
}

function findUrl(text: string): string | null {
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match?.[0] ?? null;
}

function stopChild(): void {
  if (!processRef) return;
  try { processRef.kill(); } catch { /* already exited */ }
  processRef = null;
}

export async function startPublicTunnel(port: number): Promise<PublicTunnelStatus> {
  if (status.active && processRef) return status;
  if (startPromise) return startPromise;
  startPromise = new Promise<PublicTunnelStatus>((resolve) => {
    stopChild();
    output = '';
    publish({ active: false, url: '', state: 'connecting' });
    const binary = executablePath();
    if (!fs.existsSync(binary)) {
      const error = `cloudflared binary not found: ${binary}`;
      publish({ active: false, url: '', state: 'error', error });
      resolve(status);
      return;
    }

    const child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processRef = child;
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16_000);
      const url = findUrl(output);
      if (url && status.state !== 'ready') publish({ active: true, url, state: 'ready' });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (error) => {
      processRef = null;
      if (status.state !== 'ready') publish({ active: false, url: '', state: 'error', error: error.message });
      resolve(status);
    });
    child.once('exit', (code, signal) => {
      processRef = null;
      if (status.state !== 'ready' || code !== 0) publish({ active: false, url: '', state: code === 0 ? 'stopped' : 'error', error: code === 0 ? undefined : `cloudflared exited (${code ?? signal ?? 'unknown'})` });
    });

    const timer = setInterval(() => {
      if (status.state === 'ready' || !processRef) {
        clearInterval(timer);
        resolve(status);
      }
    }, 100);
    setTimeout(() => {
      clearInterval(timer);
      if (status.state === 'connecting') {
        stopChild();
        publish({ active: false, url: '', state: 'error', error: 'cloudflared-start-timeout' });
      }
      resolve(status);
    }, 30_000).unref();
  }).finally(() => { startPromise = null; });
  return startPromise as Promise<PublicTunnelStatus>;
}

export async function stopPublicTunnel(): Promise<PublicTunnelStatus> {
  stopChild();
  publish(stoppedStatus);
  return status;
}
export function getPublicTunnelStatus(): PublicTunnelStatus { return status; }
export function disposePublicTunnel(): void { stopChild(); publish(stoppedStatus); }
