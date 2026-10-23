import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type TunnelState = 'stopped' | 'connecting' | 'ready' | 'error';
export type PublicTunnelStatus = { active: boolean; url: string; state: TunnelState; error?: string };
export type TunnelStatusListener = (status: PublicTunnelStatus) => void;

const START_TIMEOUT_MS = 30_000;
/** URL iki veri parçasına bölünürse yakalanabilsin diye önceki çıktıdan taşınan kuyruk (URL ~100 karakter). */
const OVERLAP_CHARS = 256;
// `api.trycloudflare.com` cloudflared'ın kendi API adresidir ve hata mesajlarında geçer; tünel URL'si değildir.
const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;

const STOPPED: PublicTunnelStatus = { active: false, url: '', state: 'stopped' };
const CONNECTING: PublicTunnelStatus = { active: false, url: '', state: 'connecting' };
const failed = (error: string): PublicTunnelStatus => ({ active: false, url: '', state: 'error', error });

/** `tunnel` boş değilse bir süreç ya bağlanıyor ya hazır. `settle` bekleyen start() çağrısını sonuçlandırır. */
interface Tunnel { child: ChildProcess; settle: () => void }

let status: PublicTunnelStatus = STOPPED;
let listener: TunnelStatusListener | null = null;
let tunnel: Tunnel | null = null;
let startPromise: Promise<PublicTunnelStatus> | null = null;

export function setPublicTunnelStatusListener(next: TunnelStatusListener | null): void { listener = next; }

/** Sabit durumlar (STOPPED/CONNECTING) zaten güncelse dinleyiciyi tekrar tetiklemez. */
function publish(next: PublicTunnelStatus): void {
  if (next === status) return;
  status = next;
  listener?.(next);
}

function executablePath(): string {
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
  return path.join(root, 'cloudflared', name);
}

/** Süreci sonlandırır ve bekleyen start() çağrısını o anki durumla sonuçlandırır. Çağıran durumu önce yayımlamalı. */
function killTunnel(): void {
  const current = tunnel;
  if (!current) return;
  tunnel = null;
  try { current.child.kill(); } catch { /* already exited */ }
  current.settle();
}

function shutDown(next: PublicTunnelStatus): void {
  publish(next);
  killTunnel();
}

function launch(port: number): Promise<PublicTunnelStatus> {
  const binary = executablePath();
  if (!fs.existsSync(binary)) {
    publish(failed(`cloudflared binary not found: ${binary}`));
    return Promise.resolve(status);
  }
  publish(CONNECTING);

  return new Promise<PublicTunnelStatus>((resolve) => {
    const child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (tunnel === current) shutDown(failed('cloudflared-start-timeout'));
    }, START_TIMEOUT_MS);
    timer.unref();

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const current: Tunnel = { child, settle };
    tunnel = current;

    // Yalnızca bu denemenin kendi olayları işlenir: durdurulmuş veya yerine yenisi başlamış sürecin
    // gecikmiş `exit`/`error` olayları güncel durumu ve yeni süreci bozamaz.
    const lose = (next: PublicTunnelStatus) => {
      if (tunnel !== current) return;
      tunnel = null;
      try { child.kill(); } catch { /* already exited */ }
      publish(next);
      settle();
    };
    child.once('error', (error) => lose(failed(error.message)));
    child.once('exit', (code, signal) =>
      lose(code === 0 ? STOPPED : failed(`cloudflared exited (${code ?? signal ?? 'unknown'})`)));

    const onData = (chunk: Buffer) => {
      // Sonuçlandıktan sonra çıktı taranmaz; dinleyici yalnızca boru hattını boşaltmak için kalır.
      if (settled) return;
      const text = tail + chunk.toString();
      const url = TUNNEL_URL_RE.exec(text)?.[0];
      if (url) {
        publish({ active: true, url, state: 'ready' });
        settle();
      } else {
        tail = text.slice(-OVERLAP_CHARS);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
  });
}

export async function startPublicTunnel(port: number): Promise<PublicTunnelStatus> {
  if (status.active && tunnel) return status;
  startPromise ??= launch(port).finally(() => { startPromise = null; });
  return startPromise;
}

export async function stopPublicTunnel(): Promise<PublicTunnelStatus> {
  shutDown(STOPPED);
  return status;
}

export function getPublicTunnelStatus(): PublicTunnelStatus { return status; }
export function disposePublicTunnel(): void { shutDown(STOPPED); }