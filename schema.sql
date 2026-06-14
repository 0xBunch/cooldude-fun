-- COOL DUDE'S ARCADE — leaderboard schema.
-- Applied at boot with CREATE TABLE IF NOT EXISTS (idempotent).
-- Drive is the source of truth for the game list, so there is no games table.
-- Nicknames are not accounts, so there is no users table.
--
-- game_slug is derived from the game's FILENAME (e.g. "Rocket Dodge.html" ->
-- "rocket-dodge"). Renaming a game's file changes its slug and therefore starts
-- that game a fresh leaderboard. Keep filenames stable to keep scores.

CREATE TABLE IF NOT EXISTS scores (
  id          BIGSERIAL   PRIMARY KEY,
  game_slug   TEXT        NOT NULL,
  nickname    TEXT        NOT NULL,
  score       INTEGER     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_slug_score
  ON scores (game_slug, score DESC);
