// Leaderboard storage. Uses Postgres when DATABASE_URL is set; otherwise an
// in-memory store so the arcade runs end-to-end with no database (great for
// local dev and trying the UI). Drive is the source of truth for games, so
// there is no games table here — only scores.

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from './config';

export type ScoreRow = { nickname: string; score: number; created_at: string };

let pool: Pool | null = null;

type MemScore = { id: number; game_slug: string; nickname: string; score: number; created_at: string };
const mem: MemScore[] = [];
let memId = 1;

export function usingMemory(): boolean {
  return pool === null;
}

export async function initDb(): Promise<void> {
  if (!config.databaseUrl) return; // in-memory mode
  pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(schema);
}

export async function topScores(slug: string, limit: number): Promise<ScoreRow[]> {
  const n = Math.max(1, Math.min(50, Math.floor(limit)));
  if (pool) {
    const r = await pool.query(
      `SELECT nickname, score, created_at
         FROM scores
        WHERE game_slug = $1
        ORDER BY score DESC, created_at ASC
        LIMIT $2`,
      [slug, n]
    );
    return r.rows.map((row: { nickname: string; score: number; created_at: Date }) => ({
      nickname: row.nickname,
      score: row.score,
      created_at: row.created_at.toISOString(),
    }));
  }
  return mem
    .filter((s) => s.game_slug === slug)
    .sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))
    .slice(0, n)
    .map(({ nickname, score, created_at }) => ({ nickname, score, created_at }));
}

export async function insertScore(slug: string, nickname: string, score: number): Promise<void> {
  if (pool) {
    await pool.query(
      `INSERT INTO scores (game_slug, nickname, score) VALUES ($1, $2, $3)`,
      [slug, nickname, score]
    );
    return;
  }
  mem.push({
    id: memId++,
    game_slug: slug,
    nickname,
    score,
    created_at: new Date().toISOString(),
  });
}

export async function deleteScore(id: number): Promise<boolean> {
  if (pool) {
    const r = await pool.query(`DELETE FROM scores WHERE id = $1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }
  const i = mem.findIndex((s) => s.id === id);
  if (i === -1) return false;
  mem.splice(i, 1);
  return true;
}
