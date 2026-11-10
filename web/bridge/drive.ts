// Google Drive for the web app: Google Identity Services issues a short-lived
// access token in the browser, and the Drive REST API is called directly. It
// mirrors src/main/driveService.ts: the same `drive.file` scope, the same app
// folder, the same upsert by name and the same `.gpres` payloads.
//
// A Web OAuth client is required (Google Cloud → Credentials → OAuth client ID →
// Web application, with this site's origin under "Authorized JavaScript
// origins"). Build with VITE_GOOGLE_DRIVE_CLIENT_ID=<client id>. Without it,
// Drive explains that it is not configured.
import type { DriveFile, DriveStatus } from '../../src/shared/presentation';
import { readGpres, writeGpres } from './gpres';
import { notify } from './dialogs';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID as string | undefined)?.trim() ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP_FOLDER_NAME = 'Worship Presentation Assistant';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SESSION_KEY = 'wpa-drive-token';

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type TokenClient = { requestAccessToken(options?: { prompt?: string }): void; callback: (response: TokenResponse) => void };
type Gis = {
  accounts: { oauth2: {
    initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: { type: string }) => void }): TokenClient;
    revoke(token: string, done?: () => void): void;
  } };
};

let token: { value: string; expiresAt: number } | null = null;
let email: string | null = null;
let client: TokenClient | null = null;
let pendingSignIn: ((response: TokenResponse | null) => void) | null = null;
let folderId: Promise<string> | null = null;

export const driveConfigured = () => !!CLIENT_ID;

try {
  const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  if (saved && typeof saved.value === 'string' && saved.expiresAt > Date.now() + 60_000) { token = saved; email = saved.email ?? null; }
} catch { /* storage unavailable */ }

let loading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  const existing = (window as unknown as { google?: Gis }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  loading ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve((window as unknown as { google: Gis }).google);
    script.onerror = () => { loading = null; reject(new Error('Google sign-in could not load')); };
    document.head.append(script);
  });
  return loading;
}

/** Prepares the sign-in client ahead of the click: the Google popup is only allowed right after a gesture. */
export async function prepareDrive(): Promise<void> {
  if (!CLIENT_ID || client) return;
  const gis = await loadGis();
  client = gis.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: response => { pendingSignIn?.(response); pendingSignIn = null; },
    error_callback: () => { pendingSignIn?.(null); pendingSignIn = null; },
  });
}

async function api(path: string, init: RequestInit = {}, base = API): Promise<Response> {
  if (!token || token.expiresAt <= Date.now()) { token = null; throw new Error('Drive session expired; sign in again'); }
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token.value}` } });
  if (response.status === 401) { token = null; sessionStorage.removeItem(SESSION_KEY); throw new Error('Drive session expired; sign in again'); }
  if (!response.ok) throw new Error(`Drive request failed (${response.status})`);
  return response;
}
const json = async <T>(path: string, init?: RequestInit) => (await api(path, init)).json() as Promise<T>;
const escapeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function driveStatus(): Promise<DriveStatus> {
  return token && token.expiresAt > Date.now() && email ? { signedIn: true, email } : { signedIn: false, email: null };
}

export async function driveSignIn(): Promise<DriveStatus> {
  if (!CLIENT_ID) { await notify('driveNotConfigured'); return { signedIn: false, email: null }; }
  await prepareDrive();
  const response = await new Promise<TokenResponse | null>(resolve => {
    pendingSignIn = resolve;
    client!.requestAccessToken({ prompt: email ? '' : 'select_account' });
  });
  if (!response?.access_token) return { signedIn: false, email: null };
  token = { value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
  try {
    const about = await json<{ user?: { emailAddress?: string } }>('/about?fields=user(emailAddress)');
    email = about.user?.emailAddress ?? 'Google Drive';
  } catch { email = 'Google Drive'; }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...token, email })); } catch { /* ignore */ }
  return { signedIn: true, email };
}

export async function driveSignInCancel(): Promise<void> {
  pendingSignIn?.(null);
  pendingSignIn = null;
}

export async function driveSignOut(): Promise<void> {
  const current = token?.value;
  token = null; email = null; folderId = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  if (current) { try { (await loadGis()).accounts.oauth2.revoke(current); } catch { /* offline */ } }
}

function appFolder(): Promise<string> {
  folderId ??= (async () => {
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${escapeQuery(APP_FOLDER_NAME)}' and trashed=false`);
    const list = await json<{ files?: { id: string }[] }>(`/files?q=${q}&fields=files(id)&pageSize=1`);
    if (list.files?.[0]?.id) return list.files[0].id;
    const created = await json<{ id: string }>('/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    return created.id;
  })();
  folderId.catch(() => { folderId = null; });
  return folderId;
}

export async function driveListFiles(): Promise<DriveFile[]> {
  try {
    const folder = await appFolder();
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
    const list = await json<{ files?: { id: string; name?: string; modifiedTime?: string; size?: string }[] }>(
      `/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=50`);
    return (list.files ?? []).map(f => ({ id: f.id, name: f.name ?? 'Unnamed', modifiedTime: f.modifiedTime ?? '', size: f.size }));
  } catch (error) {
    folderId = null;
    console.error('[web drive] list failed', error);
    return [];
  }
}

async function upsert(name: string, mimeType: string, body: Blob): Promise<string> {
  const folder = await appFolder();
  const q = encodeURIComponent(`name='${escapeQuery(name)}' and '${folder}' in parents and trashed=false`);
  const existing = (await json<{ files?: { id: string }[] }>(`/files?q=${q}&fields=files(id)&pageSize=1`)).files?.[0]?.id;
  if (existing) {
    await api(`/files/${existing}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mimeType }, body }, UPLOAD);
    return existing;
  }
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folder] })], { type: 'application/json' }));
  form.append('file', new Blob([body], { type: mimeType }));
  const created = await (await api('/files?uploadType=multipart&fields=id', { method: 'POST', body: form }, UPLOAD)).json() as { id: string };
  return created.id;
}

export async function driveUpload(name: string, content: string) {
  try { return { ok: true, id: await upsert(name, 'application/json', new Blob([content])) }; }
  catch (error) { return { ok: false, error: String(error) }; }
}

export async function driveSavePresentation(content: string, customName?: string) {
  try {
    const data = JSON.parse(content);
    const trimmed = (customName ?? '').trim();
    if (trimmed) data.name = trimmed;
    const baseName = String(data.name || 'presentation').replace(/[\\/:*?"<>|]/g, '_').trim() || 'presentation';
    const archive = await writeGpres(trimmed ? JSON.stringify(data) : content);
    return { ok: true, id: await upsert(`${baseName}.gpres`, 'application/octet-stream', archive) };
  } catch (error) {
    console.error('[web drive] save failed', error);
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export async function driveDownload(fileId: string) {
  try {
    if (typeof fileId !== 'string' || fileId.length > 200) throw new Error('Invalid Drive file');
    const blob = await (await api(`/files/${encodeURIComponent(fileId)}?alt=media`)).blob();
    return { ok: true, data: await readGpres(blob) };
  } catch (error) {
    console.error('[web drive] download failed', error);
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export async function driveDeleteFile(fileId: string) {
  try {
    await api(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
