import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { newToken, queryToken, tokenMatches } from './shareTransport';

/**
 * LAN remote-control authentication.
 *
 * The remote server listens on every interface, so anyone on the same Wi-Fi
 * could otherwise drive the presentation. The phone receives a long random
 * token inside the QR / URL (`/remote?token=…`); the page response stores it in
 * an HttpOnly cookie so the WebSocket handshake and preview images carry it
 * automatically. Non-browser clients may pass `?token=` on any request.
 */

export const REMOTE_COOKIE = 'wpa_remote';
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function remoteTokenFromQuery(url: string | undefined): string | null {
  return queryToken(url);
}

export function remoteTokenFromCookie(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join(';') : header;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === REMOTE_COOKIE) return part.slice(index + 1).trim() || null;
  }
  return null;
}

export function isRemoteAuthorized(req: Pick<IncomingMessage, 'url' | 'headers'>, expected: string | null): boolean {
  if (!expected) return false;
  return tokenMatches(expected, remoteTokenFromQuery(req.url)) || tokenMatches(expected, remoteTokenFromCookie(req.headers.cookie));
}

export function remoteAuthCookie(token: string): string {
  // ~400 days: a bookmarked phone stays paired across services until the token is reset.
  return `${REMOTE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000`;
}

/** Persisted so a phone's bookmark / home-screen shortcut keeps working after an app restart. */
export function loadOrCreateRemoteToken(file: string): string {
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (TOKEN_RE.test(existing)) return existing;
  } catch { /* first run or unreadable: create a new one */ }
  return writeNewRemoteToken(file);
}

/**
 * Replaces the token, so every phone paired so far loses access (their cookie and
 * bookmarked link stop matching). Used by "Disconnect paired phones".
 */
export function writeNewRemoteToken(file: string): string {
  const token = newToken();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, token, { encoding: 'utf-8', mode: 0o600 });
  } catch (error) {
    // Still secure: the token just will not survive a restart.
    console.error('[remote-auth] Could not persist remote token:', error);
  }
  return token;
}

// ─── Settings ──────────────────────────────────────────────────────────────

export interface RemoteSettings {
  /** Start the phone server when the app starts (default: only when a phone feature is used). */
  autoStart: boolean;
  /** Last port the server listened on; tried first so bookmarked links survive restarts. */
  port: number | null;
}

const validPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535;

export function readRemoteSettings(file: string): RemoteSettings {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { autoStart: value?.autoStart === true, port: validPort(value?.port) ? value.port : null };
  } catch {
    return { autoStart: false, port: null };
  }
}

export function writeRemoteSettings(file: string, patch: Partial<RemoteSettings>): RemoteSettings {
  const current = readRemoteSettings(file);
  const next: RemoteSettings = {
    autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : current.autoStart,
    port: 'port' in patch ? (validPort(patch.port) ? patch.port : null) : current.port,
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next), 'utf-8');
    fs.renameSync(temp, file);
  } catch (error) {
    console.error('[remote-auth] Could not save remote settings:', error);
  }
  return next;
}
