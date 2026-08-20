import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// ─── Soniox API key storage ─────────────────────────────────────────────────
// Same pattern as driveService.ts: the key is encrypted at rest with
// Electron's safeStorage (OS-level encryption — DPAPI / Keychain / kwallet)
// and stored under userData. The renderer never receives the key; it only
// learns whether one is configured (plus a masked hint).

const KEY_FILE = path.join(app.getPath('userData'), 'soniox-key.enc');

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}

export function getApiKey(): string | null {
  try {
    const encrypted = fs.readFileSync(KEY_FILE);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(encrypted);
    }
    return encrypted.toString('utf-8');
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  const raw = Buffer.from(trimmed, 'utf-8');
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(trimmed) : raw;
  fs.writeFileSync(KEY_FILE, data);
}

export function deleteApiKey(): void {
  try {
    fs.unlinkSync(KEY_FILE);
  } catch {
    // Nothing stored — fine.
  }
}

/** Masked hint for the UI (e.g. "••••1234"). Never returns the full key. */
export function keyHint(): string | null {
  const key = getApiKey();
  if (!key) return null;
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}
