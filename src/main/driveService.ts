import { app, safeStorage, shell } from 'electron';
import { drive as googleDrive, auth } from '@googleapis/drive';
import { CodeChallengeMethod, type Credentials, type OAuth2Client } from 'google-auth-library';
import http from 'node:http';
import path from 'node:path';
import fsSync from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { DRIVE_CREDENTIALS } from './driveCredentials';

const TOKEN_FILE = path.join(app.getPath('userData'), 'drive-token.enc');
const APP_FOLDER_NAME = 'Worship Presentation Assistant';
const SIGN_IN_TIMEOUT_MS = 120_000;
const CALLBACK_PATH = '/oauth2callback';
const SUCCESS_PAGE =
  '<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#1a1a2e;color:#fff"><div style="text-align:center"><h2>✅ Giriş başarılı!</h2><p>Uygulamaya dönebilirsiniz.</p></div></body></html>';

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

export interface DriveStatus {
  signedIn: boolean;
  email: string | null;
}

type Drive = ReturnType<typeof googleDrive>;

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** Drive sorgu dizgisi için `\` ve `'` kaçırılır (yalnızca `'` kaçırmak `\` içeren adları bozar). */
const escapeQuery = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function isInvalidGrant(error: unknown): boolean {
  const e = error as { message?: string; response?: { data?: { error?: string } } } | null;
  return e?.response?.data?.error === 'invalid_grant' || /invalid_grant/.test(e?.message ?? '');
}

function readToken(): Credentials | null {
  try {
    const encrypted = fsSync.readFileSync(TOKEN_FILE);
    let json: string;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        json = safeStorage.decryptString(encrypted);
      } catch {
        // Şifreleme kullanılamazken düz metin yazılmış dosya olabilir.
        json = encrypted.toString('utf-8');
      }
    } else {
      json = encrypted.toString('utf-8');
    }
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Credentials) : null;
  } catch {
    return null;
  }
}

/** Atomik yazma: yarım kalan yazma mevcut token dosyasını bozamaz. Dosya küçük ve seyrek yazıldığı için senkron bırakıldı. */
function writeToken(token: Credentials): void {
  const raw = JSON.stringify(token);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(raw) : Buffer.from(raw, 'utf-8');
  const temp = `${TOKEN_FILE}.${process.pid}.tmp`;
  try {
    fsSync.writeFileSync(temp, data, { mode: 0o600 });
    fsSync.renameSync(temp, TOKEN_FILE);
  } catch (error) {
    try { fsSync.unlinkSync(temp); } catch { /* temp file cleanup */ }
    throw error;
  }
}

function deleteToken(): void {
  try { fsSync.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

class GoogleDriveService {
  private oAuth2Client: OAuth2Client | null = null;
  private drive: Drive | null = null;
  private folderPromise: Promise<string> | null = null;
  /** undefined: henüz öğrenilmedi (ağ hatası dahil, yeniden denenir). null: Google e-posta döndürmedi. */
  private email: string | null | undefined;
  private signInPromise: Promise<DriveStatus> | null = null;
  // Live OAuth attempt, kept so the user can cancel it (closing the Google tab,
  // picking no account) instead of leaving the panel spinning forever.
  private pendingSignIn: {
    server: http.Server;
    timer: ReturnType<typeof setTimeout>;
    reject: (error: Error) => void;
  } | null = null;

  /** Aktif istemciyi değiştirir ve ona bağlı tüm önbellekleri sıfırlar. */
  private setClient(client: OAuth2Client | null): void {
    this.oAuth2Client = client;
    this.drive = null;
    this.folderPromise = null;
    this.email = undefined;
  }

  /** Yenilenen token'ları kalıcı hale getirir. Çıkış yapılmış veya değiştirilmiş istemcinin gecikmiş olayları yok sayılır. */
  private adopt(client: OAuth2Client, initial: Credentials): void {
    let saved = initial;
    client.on('tokens', (fresh) => {
      if (this.oAuth2Client !== client) return;
      saved = { ...saved, ...fresh };
      try { writeToken(saved); } catch { /* oturum bellekte çalışmaya devam eder */ }
    });
    this.setClient(client);
  }

  private getClient(): OAuth2Client | null {
    if (this.oAuth2Client) return this.oAuth2Client;
    const token = readToken();
    if (!token) return null;
    const client = new auth.OAuth2(DRIVE_CREDENTIALS.clientId, DRIVE_CREDENTIALS.clientSecret);
    client.setCredentials(token);
    this.adopt(client, token);
    return client;
  }

  async getStatus(): Promise<DriveStatus> {
    const client = this.getClient();
    if (!client) return { signedIn: false, email: null };

    if (this.email === undefined) {
      try {
        const email = await this.fetchUserEmail(client);
        if (this.oAuth2Client === client) this.email = email;
      } catch (error) {
        if (isInvalidGrant(error)) {
          // Yenileme token'ı iptal edilmiş: oturum artık geçersiz.
          if (this.oAuth2Client === client) this.signOut();
          return { signedIn: false, email: null };
        }
        // Ağ hatası gibi geçici sorunlarda oturum açık sayılır; e-posta sonraki çağrıda yeniden denenir.
      }
    }
    if (this.oAuth2Client !== client) return { signedIn: false, email: null };
    return { signedIn: true, email: this.email ?? null };
  }

  /** Eşzamanlı çağrılar aynı akışı paylaşır; ikinci tıklama ikinci bir sunucu ve tarayıcı sekmesi açmaz. */
  signIn(): Promise<DriveStatus> {
    this.signInPromise ??= this.performSignIn().finally(() => { this.signInPromise = null; });
    return this.signInPromise;
  }

  private async performSignIn(): Promise<DriveStatus> {
    const { code, client, codeVerifier } = await this.startOAuthFlow();
    const { tokens } = await client.getToken({ code, codeVerifier });
    client.setCredentials(tokens);
    writeToken(tokens);
    this.adopt(client, tokens);
    this.email = await this.fetchUserEmail(client).catch(() => undefined);
    return { signedIn: true, email: this.email ?? null };
  }

  isSigningIn(): boolean {
    return !!this.pendingSignIn;
  }

  private startOAuthFlow(): Promise<{ code: string; client: OAuth2Client; codeVerifier: string }> {
    return new Promise((resolve, reject) => {
      const state = randomBytes(16).toString('hex');
      let client: OAuth2Client | null = null;
      let codeVerifier = '';
      let settled = false;

      const finish = (error?: Error, code?: string) => {
        if (settled) return;
        settled = true;
        this.clearPending();
        if (code && client) resolve({ code, client, codeVerifier });
        else reject(error ?? new Error('No authorization code in callback'));
      };

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        // Beklenen yol ve bu oturumun state değeri dışındaki istekler (favicon, yerel başka süreçler)
        // yanıtlanır ama akışı bozmaz; yanıtsız bırakılan istek bağlantıyı açık tutardı.
        if (url.pathname !== CALLBACK_PATH || url.searchParams.get('state') !== state) {
          res.writeHead(url.pathname === CALLBACK_PATH ? 400 : 404, { Connection: 'close' }).end();
          return;
        }
        const code = url.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
          res.end(SUCCESS_PAGE);
          finish(undefined, code);
        } else {
          res.writeHead(400, { Connection: 'close' });
          res.end('Authorization code not found');
          finish(new Error(url.searchParams.get('error') ?? 'No authorization code in callback'));
        }
      });

      // Zamanlayıcı ve iptal kancası dinlemeye başlamadan kurulur: kullanıcı hemen iptal edebilir.
      const timer = setTimeout(() => finish(new Error('Authorization timeout')), SIGN_IN_TIMEOUT_MS);
      this.pendingSignIn = { server, timer, reject: (error) => finish(error) };
      server.on('error', (error) => finish(error));

      server.listen(DRIVE_CREDENTIALS.redirectPort || 0, '127.0.0.1', async () => {
        try {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          const oauth = new auth.OAuth2(
            DRIVE_CREDENTIALS.clientId,
            DRIVE_CREDENTIALS.clientSecret,
            `http://127.0.0.1:${port}${CALLBACK_PATH}`,
          );
          client = oauth;
          const pkce = await oauth.generateCodeVerifierAsync();
          codeVerifier = pkce.codeVerifier;
          const authUrl = oauth.generateAuthUrl({
            access_type: 'offline',
            scope: DRIVE_CREDENTIALS.scopes,
            prompt: 'consent',
            state,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: CodeChallengeMethod.S256,
          });
          if (settled) return; // PKCE üretilirken iptal edildi
          await shell.openExternal(authUrl);
        } catch (error) {
          finish(toError(error));
        }
      });
    });
  }

  private clearPending(): void {
    const pending = this.pendingSignIn;
    this.pendingSignIn = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    try {
      pending.server.close();
      // Tarayıcının açık bıraktığı boşta bağlantılar portu tutmasın.
      pending.server.closeIdleConnections();
    } catch {
      /* already closed */
    }
  }

  // Aborts an in-flight sign-in; signIn() rejects and the UI returns to its
  // signed-out state. Safe to call when nothing is pending.
  cancelSignIn(): void {
    this.pendingSignIn?.reject(new Error('cancelled'));
  }

  private async fetchUserEmail(client: OAuth2Client): Promise<string | null> {
    const res = await client.request<{ email?: string }>({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' });
    return res.data.email ?? null;
  }

  signOut(): void {
    deleteToken();
    this.setClient(null);
  }

  private getDrive(): Drive {
    const client = this.getClient();
    if (!client) throw new Error('Not signed in');
    return (this.drive ??= googleDrive({ version: 'v3', auth: client }));
  }

  /** Eşzamanlı çağrılar tek arama/oluşturma paylaşır; böylece çift klasör oluşmaz. */
  private ensureAppFolder(drive: Drive): Promise<string> {
    if (this.folderPromise) return this.folderPromise;
    const pending = this.findOrCreateAppFolder(drive);
    this.folderPromise = pending;
    pending.catch(() => {
      if (this.folderPromise === pending) this.folderPromise = null;
    });
    return pending;
  }

  private async findOrCreateAppFolder(drive: Drive): Promise<string> {
    const list = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${escapeQuery(APP_FOLDER_NAME)}' and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    const existing = list.data.files?.[0]?.id;
    if (existing) return existing;

    const folder = await drive.files.create({
      requestBody: { name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    return folder.data.id!;
  }

  /** Klasör kimliği önbellekte tutulur; işlem hata verirse (klasör silinmiş olabilir) önbellek atılır. */
  private async inAppFolder<T>(task: (drive: Drive, folderId: string) => Promise<T>): Promise<T> {
    const drive = this.getDrive();
    const folderId = await this.ensureAppFolder(drive);
    try {
      return await task(drive, folderId);
    } catch (error) {
      this.folderPromise = null;
      throw error;
    }
  }

  async listFiles(): Promise<DriveFileInfo[]> {
    return this.inAppFolder(async (drive, folderId) => {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, modifiedTime, size)',
        orderBy: 'modifiedTime desc',
        pageSize: 50,
      });
      return (res.data.files ?? []).map((f) => ({
        id: f.id!,
        name: f.name ?? 'Unnamed',
        modifiedTime: f.modifiedTime ?? '',
        size: f.size ?? undefined,
      }));
    });
  }

  /** Aynı adlı dosya varsa günceller, yoksa oluşturur. `makeBody` yalnızca gerçekten yüklenirken akış üretir. */
  private upsertFile(name: string, mimeType: string, makeBody: () => string | PassThrough): Promise<string> {
    return this.inAppFolder(async (drive, folderId) => {
      const existing = await drive.files.list({
        q: `name='${escapeQuery(name)}' and '${folderId}' in parents and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
      });
      const media = { mimeType, body: makeBody() };
      const existingId = existing.data.files?.[0]?.id;
      if (existingId) {
        await drive.files.update({ fileId: existingId, media });
        return existingId;
      }
      const file = await drive.files.create({ requestBody: { name, parents: [folderId] }, media, fields: 'id' });
      return file.data.id!;
    });
  }

  uploadFile(name: string, content: string): Promise<string> {
    return this.upsertFile(name, 'application/json', () => content);
  }

  uploadBuffer(name: string, buffer: Buffer): Promise<string> {
    // Geçici dosya yok: tampon doğrudan akışa verilir (diske yazma, senkron G/Ç ve temizlik gitti).
    return this.upsertFile(name, 'application/octet-stream', () => {
      const stream = new PassThrough();
      stream.end(buffer);
      return stream;
    });
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const res = await this.getDrive().files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const data = res.data as unknown as ArrayBuffer | Buffer;
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.getDrive().files.delete({ fileId });
  }
}

export const driveService = new GoogleDriveService();