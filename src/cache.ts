// The games index. Lists the Drive folder, partitions games (.html) from
// thumbnails (.png/.jpg), assigns slugs, and caches everything in memory with a
// 60s TTL. A background refresh keeps it warm; on Drive errors we serve stale.
// Single-replica service => an in-memory cache is coherent and correct.

import { getProvider, DriveFile, mimeForName } from './drive';
import { baseName, toSlug } from './slug';
import { injectSdk } from './inject';

export type GameMeta = {
  slug: string;
  title: string;
  fileId: string;
  modifiedTime: string;
  thumbFileId?: string;
  thumbName?: string;
};

const TTL_MS = 60_000;

type Index = { list: GameMeta[]; bySlug: Map<string, GameMeta>; at: number };
let index: Index | null = null;
let refreshing: Promise<void> | null = null;

// Transformed (SDK-injected) game HTML, keyed by slug, invalidated by modifiedTime.
const htmlCache = new Map<string, { key: string; html: string }>();

const isHtml = (f: DriveFile) => /\.html?$/i.test(f.name) || f.mimeType === 'text/html';
const isImage = (f: DriveFile) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);

async function build(): Promise<void> {
  const files = await getProvider().list();

  const images = new Map<string, DriveFile>();
  for (const f of files) {
    if (isImage(f)) images.set(baseName(f.name).toLowerCase(), f);
  }

  // Assign slugs in a stable order (by fileId) so a game's slug — the leaderboard
  // join key — doesn't flip when an unrelated game is renamed or edited.
  const htmlFiles = files.filter(isHtml).sort((a, b) => a.id.localeCompare(b.id));

  const list: GameMeta[] = [];
  const bySlug = new Map<string, GameMeta>();
  for (const f of htmlFiles) {
    const title = baseName(f.name);
    let slug = toSlug(title) || 'game';
    if (bySlug.has(slug)) {
      let n = 2;
      while (bySlug.has(`${slug}-${n}`)) n++;
      console.warn(`[cache] slug collision for "${f.name}" -> ${slug}-${n}`);
      slug = `${slug}-${n}`;
    }
    const img = images.get(title.toLowerCase());
    const meta: GameMeta = {
      slug,
      title,
      fileId: f.id,
      modifiedTime: f.modifiedTime,
      thumbFileId: img?.id,
      thumbName: img?.name,
    };
    list.push(meta);
    bySlug.set(slug, meta);
  }

  list.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)); // newest first
  index = { list, bySlug, at: Date.now() };
}

export function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = build()
    .catch((e) => console.error('[cache] refresh failed:', e?.message ?? e))
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function ensureFresh(): Promise<void> {
  if (!index) {
    await refresh();
    return;
  }
  if (Date.now() - index.at > TTL_MS) {
    void refresh(); // serve stale, refresh in background
  }
}

export async function getGames(): Promise<GameMeta[]> {
  await ensureFresh();
  return index?.list ?? [];
}

export async function getGame(slug: string): Promise<GameMeta | undefined> {
  await ensureFresh();
  return index?.bySlug.get(slug);
}

export async function getGameHtml(slug: string): Promise<string | null> {
  const meta = await getGame(slug);
  if (!meta) return null;
  const cached = htmlCache.get(slug);
  if (cached && cached.key === meta.modifiedTime) return cached.html;
  let buf: Buffer;
  try {
    buf = await getProvider().getContent(meta.fileId);
  } catch (e) {
    // Deleted/moved between refreshes, or a transient Drive error: 404, not 500.
    console.error('[cache] getContent failed for', slug, e instanceof Error ? e.message : e);
    return null;
  }
  const html = injectSdk(buf.toString('utf8'));
  htmlCache.set(slug, { key: meta.modifiedTime, html });
  return html;
}

export async function getThumb(slug: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const meta = await getGame(slug);
  if (!meta?.thumbFileId) return null;
  try {
    const buffer = await getProvider().getContent(meta.thumbFileId);
    return { buffer, contentType: mimeForName(meta.thumbName ?? 'thumb.png') };
  } catch (e) {
    console.error('[cache] thumb fetch failed for', slug, e instanceof Error ? e.message : e);
    return null;
  }
}

export function startRefreshLoop(): void {
  const t = setInterval(() => void refresh(), TTL_MS);
  t.unref?.();
}
