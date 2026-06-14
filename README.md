# COOL DUDEZ ARCADE 🕹️

A tiny home for James's mini web games, at **cooldude.fun**. Drop a game's
`.html` file into a Google Drive folder and it shows up in the arcade within a
minute — friends play it and chase a shared live leaderboard.

> A **Based Compute** project.

## How it works

One small Node service does everything:

- **Games come from Google Drive.** The service lists a shared Drive folder
  (cached 60s). `Rocket Dodge.html` → a game tile titled “Rocket Dodge”. No
  deploy, no code — James just drops files in the folder.
- **Games run sandboxed.** Each game is served on a separate `games.` origin
  inside a `sandbox="allow-scripts"` iframe (an *opaque* origin). It can't touch
  the arcade's cookies or storage, and reports scores to the shell only via
  `postMessage`. The shell is the only thing that submits scores.
- **Shared leaderboard.** Nicknames only (remembered on-device, no logins).
- **Soft gate.** One shared "arcade code" unlocks score-posting.

```
cooldude.fun (shell + /api + thumbs)  ──frames──▶  games.cooldude.fun (/g/:slug, sandboxed)
        │                                                   │
        └── the only caller of POST /api/scores ◀──postMessage── window.Arcade.submitScore()
```

## Run it locally (no Drive, no database needed)

```bash
npm install
npm run dev          # http://localhost:8787
```

With no credentials set, it falls back to:
- **games** from the local `games-local/` folder (a sample game is included), and
- an **in-memory** leaderboard.

Default arcade code is `letmein` (override with `ARCADE_CODE`). Copy
`.env.example` to `.env` to change anything.

```bash
npm run build        # type-check + compile to dist/
npm start            # run the compiled server
```

## Make a game (the Recipe)

Paste this into Claude (or any AI that makes web pages), tweak the idea, save the
result as `My Game.html`, and drop it in the Drive folder. Also lives at `/make`.

> Make me a single-file HTML game for Cool Dudez Arcade.
> 1. Put EVERYTHING in ONE `.html` file — all HTML, CSS, and JavaScript inline. No separate files, no internet links, no build step.
> 2. It must work when I just open the file in a browser.
> 3. When the game ends with a final score, call exactly: `window.Arcade?.submitScore(finalScore);` (a whole number; the `?.` keeps it safe outside the arcade).
> 4. Optional: greet the player using `window.Arcade?.nickname`.
> 5. Make it colorful, fun, and kid-friendly for a 9-year-old.
> My game idea: <describe it>. Give me the full `.html` file.

Optional: drop an image with the same name (`My Game.png`) for a custom tile.

## Production setup

### 1. Google Drive (one time, hands-off after)

1. [Google Cloud Console](https://console.cloud.google.com/) → new project → enable the **Google Drive API**.
2. Create a **service account**, then create a **JSON key** for it.
3. Note the service account email (`…@…iam.gserviceaccount.com`).
4. In Google Drive, create the games folder and **share it (Viewer) with that email**.
5. Grab the folder ID from its URL (`drive.google.com/drive/folders/<THIS>`).
6. Base64 the key for the env var: `base64 -i key.json | tr -d '\n'`.

### 2. Railway

- One project with the **Postgres** plugin (injects `DATABASE_URL`).
- One **service** from this repo (Nixpacks autodetects Node + installs deps):
  build `npm run build`, start `node dist/server.js`.
- Add **two custom domains to the same service**: `cooldude.fun` and
  `games.cooldude.fun` (the service splits traffic by `Host`).
- **Keep `numReplicas` at 1.** The games cache and rate limiter hold in-memory
  state and assume a single process. Scaling out would break their coherence.
- In production the server refuses to boot if `COOKIE_SECRET`, `ARCADE_CODE`,
  `PUBLIC_BASE_URL`, or `GAMES_BASE_URL` is missing (fails closed, never on the
  dev-default secret).

> **Renaming a game resets its leaderboard.** A game's identity is its filename
> (`Rocket Dodge.html` → `rocket-dodge`). Rename the file and its old scores
> orphan. Keep filenames stable.

### 3. Environment variables

| Var | What |
|---|---|
| `DATABASE_URL` | Auto-injected by Railway Postgres. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The service-account key (raw JSON or base64). |
| `DRIVE_FOLDER_ID` | The shared games folder ID. |
| `ARCADE_CODE` | The shared code kids type once. |
| `COOKIE_SECRET` | Long random string (signs the gate cookie). |
| `ADMIN_TOKEN` | For deleting a bad score (see below). |
| `PUBLIC_BASE_URL` | `https://cooldude.fun` |
| `GAMES_BASE_URL` | `https://games.cooldude.fun` |
| `NODE_ENV` | `production` |

## Moderation

Scores are submitted from the browser and are therefore forgeable — that's fine
for a friends-only arcade. Guards in place: the soft gate, per-device/IP rate
limits, score bounds, and a profanity filter on nicknames. To remove a bad row:

```bash
curl -X DELETE https://cooldude.fun/api/scores/<id> -H "x-admin-token: $ADMIN_TOKEN"
```

## API

| Route | |
|---|---|
| `GET /api/session` | `{ gated, gamesBaseUrl }` |
| `POST /api/gate` | `{ code }` → sets gate cookie |
| `GET /api/games` | `[{ slug, title, thumbUrl }]` |
| `GET /api/scores/:slug?limit=10` | top scores |
| `POST /api/scores` | `{ slug, nickname, score }` (gated) |
| `DELETE /api/scores/:id` | owner-only (`x-admin-token`) |
