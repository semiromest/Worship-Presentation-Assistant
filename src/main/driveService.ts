import { app, safeStorage, shell } from 'electron';
import { drive as googleDrive, auth } from '@googleapis/drive';
import type { OAuth2Client } from 'google-auth-library';
import http from 'node:http';
import path from 'node:path';
import fsSync from 'node:fs';
import { DRIVE_CREDENTIALS } from './driveCredentials';

const TOKEN_FILE = path.join(app.getPath('userData'), 'drive-token.enc');
const APP_FOLDER_NAME = 'Worship Presentation Assistant';

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

type TokenResult = { refresh_token?: string; access_token?: string; expiry_date?: number } | null;

function getStoredToken(): TokenResult {
  try {
    const encrypted = fsSync.readFileSync(TOKEN_FILE);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted);
    }
    return JSON.parse(encrypted.toString('utf-8'));
  } catch {
    return null;
  }
}

function saveToken(token: object): void {
  const raw = JSON.stringify(token);
  let data: Buffer;
  if (safeStorage.isEncryptionAvailable()) {
    data = safeStorage.encryptString(raw);
  } else {
    data = Buffer.from(raw, 'utf-8');
  }
  fsSync.writeFileSync(TOKEN_FILE, data);
}

function deleteToken(): void {
  try { fsSync.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

class GoogleDriveService {
  private oAuth2Client: OAuth2Client | null = null;
  private cachedEmail: string | null = null;

  private createClient(): OAuth2Client {
    return new auth.OAuth2(
      DRIVE_CREDENTIALS.clientId,
      DRIVE_CREDENTIALS.clientSecret,
    );
  }

  private async getAuthenticatedClient(): Promise<OAuth2Client | null> {
    if (this.oAuth2Client) return this.oAuth2Client;

    const token = getStoredToken();
    if (!token) return null;

    const client = this.createClient();
    client.setCredentials(token);
    client.on('tokens', (newTokens) => {
      const merged = { ...token, ...newTokens };
      saveToken(merged);
    });

    this.oAuth2Client = client;
    return client;
  }

  async getStatus(): Promise<DriveStatus> {
    const client = await this.getAuthenticatedClient();
    if (!client) return { signedIn: false, email: null };

    if (this.cachedEmail) return { signedIn: true, email: this.cachedEmail };

    try {
      const info = await this.fetchUserEmail(client);
      this.cachedEmail = info;
      return { signedIn: true, email: this.cachedEmail };
    } catch {
      return { signedIn: false, email: null };
    }
  }

  async signIn(): Promise<DriveStatus> {
    const { code, client: oauthClient } = await this.startOAuthFlow();

    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);

    oauthClient.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      saveToken(merged);
    });

    saveToken(tokens);

    this.oAuth2Client = oauthClient;

    this.cachedEmail = await this.fetchUserEmail(oauthClient);

    return { signedIn: true, email: this.cachedEmail };
  }

  private startOAuthFlow(): Promise<{ code: string; client: OAuth2Client }> {
    let oauthClient: OAuth2Client | null = null;

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/oauth2callback') {
          const codeParam = url.searchParams.get('code');
          if (codeParam && oauthClient) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#1a1a2e;color:#fff"><div style="text-align:center"><h2>✅ Giriş başarılı!</h2><p>Uygulamaya dönebilirsiniz.</p></div></body></html>');
            resolve({ code: codeParam, client: oauthClient });
          } else {
            res.writeHead(400);
            res.end('Authorization code not found');
            reject(new Error('No authorization code in callback'));
          }
          server.close();
        }
      });

      const port = DRIVE_CREDENTIALS.redirectPort || 0;
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${actualPort}/oauth2callback`;

        oauthClient = new auth.OAuth2(
          DRIVE_CREDENTIALS.clientId,
          DRIVE_CREDENTIALS.clientSecret,
          redirectUri,
        );

        const authUrl = oauthClient.generateAuthUrl({
          access_type: 'offline',
          scope: DRIVE_CREDENTIALS.scopes,
          prompt: 'consent',
        });

        shell.openExternal(authUrl);

        setTimeout(() => reject(new Error('Authorization timeout')), 120_000);
      });

      server.on('error', reject);
    });
  }

  private async fetchUserEmail(client: OAuth2Client): Promise<string | null> {
    try {
      const res = await client.request({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' });
      return (res.data as { email?: string }).email ?? null;
    } catch {
      return null;
    }
  }

  signOut(): void {
    deleteToken();
    this.oAuth2Client = null;
    this.cachedEmail = null;
  }

  private async getDrive() {
    const client = await this.getAuthenticatedClient();
    if (!client) throw new Error('Not signed in');
    return googleDrive({ version: 'v3', auth: client });
  }

  private async ensureAppFolder(): Promise<string> {
    const drive = await this.getDrive();

    const list = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${APP_FOLDER_NAME}' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (list.data.files?.length) {
      return list.data.files[0].id!;
    }

    const folder = await drive.files.create({
      requestBody: {
        name: APP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    return folder.data.id!;
  }

  async listFiles(): Promise<DriveFileInfo[]> {
    const drive = await this.getDrive();
    const folderId = await this.ensureAppFolder();

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
  }

  async uploadFile(name: string, content: string): Promise<string> {
    const drive = await this.getDrive();
    const folderId = await this.ensureAppFolder();

    const existing = await drive.files.list({
      q: `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
    });

    const requestBody = { name, parents: [folderId] };
    const media = { mimeType: 'application/json', body: content };

    if (existing.data.files?.length) {
      await drive.files.update({ fileId: existing.data.files[0].id!, media });
      return existing.data.files[0].id!;
    }

    const file = await drive.files.create({ requestBody, media, fields: 'id' });
    return file.data.id!;
  }

  async uploadBuffer(name: string, buffer: Buffer): Promise<string> {
    const drive = await this.getDrive();
    const folderId = await this.ensureAppFolder();

    // Temp file approach: googleapis drive client needs a ReadStream (has .pipe + known length)
    const tmpPath = path.join(app.getPath('temp'), `gpres-upload-${Date.now()}.gpres`);
    fsSync.writeFileSync(tmpPath, buffer);

    try {
      const existing = await drive.files.list({
        q: `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
      });

      const body = fsSync.createReadStream(tmpPath);
      const media = { mimeType: 'application/octet-stream', body };

      if (existing.data.files?.length) {
        await drive.files.update({ fileId: existing.data.files[0].id!, media });
        return existing.data.files[0].id!;
      }

      const file = await drive.files.create({ requestBody: { name, parents: [folderId] }, media, fields: 'id' });
      return file.data.id!;
    } finally {
      try { fsSync.unlinkSync(tmpPath); } catch { /* temp file cleanup */ }
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const drive = await this.getDrive();

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );

    return Buffer.from(res.data as ArrayBuffer);
  }

  async deleteFile(fileId: string): Promise<void> {
    const drive = await this.getDrive();
    await drive.files.delete({ fileId });
  }
}

export const driveService = new GoogleDriveService();
