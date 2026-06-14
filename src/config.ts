// Central config: load + validate environment. Fails soft in dev (sensible
// fallbacks), so the whole arcade can run offline with no Drive and no DB.
//
// This module has no imports, so it is safe to load the local .env here (before
// any process.env read). In production there is no .env file and this no-ops.
try {
  (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch {
  /* no .env present (e.g. production) — fine */
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const port = Number(process.env.PORT || 8787);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const gamesBaseUrl = process.env.GAMES_BASE_URL || publicBaseUrl;
const publicHost = hostOf(publicBaseUrl);
const gamesHost = hostOf(gamesBaseUrl);

export const config = {
  port,
  isProd: process.env.NODE_ENV === 'production',

  publicBaseUrl,
  gamesBaseUrl,
  publicHost,
  gamesHost,
  // When the two hosts are identical (local dev), we can't split by Host header,
  // so we serve everything on one origin and rely on the iframe sandbox (opaque
  // origin) for the security boundary. In prod the hosts differ.
  sameHost: publicHost === gamesHost,

  // Soft gate
  arcadeCode: process.env.ARCADE_CODE || 'letmein',
  cookieSecret: process.env.COOKIE_SECRET || 'dev-insecure-cookie-secret-change-me',
  adminToken: process.env.ADMIN_TOKEN || '',

  // Studio (kids' game-maker, served at /studio). Both empty => Studio is OFF and
  // the arcade is unaffected — so adding these can never break a running arcade.
  studioCode: process.env.STUDIO_CODE || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // Database (empty => in-memory leaderboard)
  databaseUrl: process.env.DATABASE_URL || '',

  // Google Drive (empty => local games-local/ folder)
  driveFolderId: process.env.DRIVE_FOLDER_ID || '',
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  localGamesDir: process.env.LOCAL_GAMES_DIR || 'games-local',
};

// In production, refuse to boot on a missing secret rather than silently running
// on the insecure dev defaults (which are committed to the repo).
if (config.isProd) {
  const required: Record<string, string | undefined> = {
    COOKIE_SECRET: process.env.COOKIE_SECRET,
    ARCADE_CODE: process.env.ARCADE_CODE,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    GAMES_BASE_URL: process.env.GAMES_BASE_URL,
  };
  const missing = Object.keys(required).filter((k) => !required[k]);
  if (missing.length) {
    throw new Error(`Refusing to start in production — missing env: ${missing.join(', ')}`);
  }
}

export type Config = typeof config;
