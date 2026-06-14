// Game source. In production, reads the shared Google Drive folder via a
// service account (hands-off, no OAuth). With no credentials it falls back to a
// local "games-local/" folder so the whole arcade runs offline.

import { google } from 'googleapis';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { config } from './config';

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string };

export interface GameProvider {
  mode: 'drive' | 'local';
  list(): Promise<DriveFile[]>;
  getContent(id: string): Promise<Buffer>;
}

function parseServiceAccount(raw: string): Record<string, unknown> {
  const txt = raw.trim();
  const json = txt.startsWith('{') ? txt : Buffer.from(txt, 'base64').toString('utf8');
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON — check the env var.'
    );
  }
}

class GoogleDriveProvider implements GameProvider {
  mode = 'drive' as const;
  private drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
      credentials: parseServiceAccount(config.serviceAccountJson),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    }),
  });

  async list(): Promise<DriveFile[]> {
    const res = await this.drive.files.list({
      q: `'${config.driveFolderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      pageSize: 200,
      orderBy: 'modifiedTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return (res.data.files ?? [])
      .filter((f) => f.id && f.name)
      .map((f) => ({
        id: f.id as string,
        name: f.name as string,
        mimeType: f.mimeType ?? '',
        modifiedTime: f.modifiedTime ?? '',
      }));
  }

  async getContent(id: string): Promise<Buffer> {
    const res = await this.drive.files.get(
      { fileId: id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(res.data as ArrayBuffer);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

class LocalFolderProvider implements GameProvider {
  mode = 'local' as const;
  private dir = join(process.cwd(), config.localGamesDir);

  async list(): Promise<DriveFile[]> {
    if (!existsSync(this.dir)) return [];
    const out: DriveFile[] = [];
    for (const name of readdirSync(this.dir)) {
      if (name.startsWith('.')) continue;
      const full = join(this.dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      out.push({
        id: name,
        name,
        mimeType: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
        modifiedTime: st.mtime.toISOString(),
      });
    }
    return out;
  }

  async getContent(id: string): Promise<Buffer> {
    // id is a bare filename from list(); basename() defends against traversal.
    return readFileSync(join(this.dir, basename(id)));
  }
}

let provider: GameProvider | null = null;

export function getProvider(): GameProvider {
  if (provider) return provider;
  provider =
    config.serviceAccountJson && config.driveFolderId
      ? new GoogleDriveProvider()
      : new LocalFolderProvider();
  return provider;
}

export function mimeForName(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
}
