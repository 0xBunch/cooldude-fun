# COOL DUDEZ STUDIO — Backlog

> The kids' game-maker at **cooldude.fun/studio** (gate code currently `letsplay`).
> This is the running backlog: what's shipped, the priority feature, what we deferred,
> and future ideas. It is the cross-session source of truth — written to stand alone.
> Full original design + security review: `.claude/plans/i-want-to-add-mossy-crescent.md`.
>
> **Architecture in one breath:** Claude Sonnet 4.6 wizard fills a small JSON `GameSpec`
> (kit + characters + theme); an assembler base64-injects it into a pre-tested kit
> HTML template → one self-contained game; previews play sandboxed on the games origin.
> Code lives in `src/studio/*`, `src/routes/studio*.ts`, `public-studio/*`.

---

## ✅ Shipped (live in production)

- **Wizard** (`src/studio/wizard.ts`) — Sonnet 4.6, forced `present_step` tool → `{prompt, chips, allowFreeform, specPatch, done}`. Kid input fenced as data; every field re-validated server-side (`src/studio/spec.ts` = the security allow-list).
- **3 verb-kits** — Catch / Dodge / Shoot (`src/studio/kits/templates/*.html`), emoji sprites.
- **Assembler** (`src/studio/assembler.ts`) — safe base64 injection; PNG-only/charset asserts.
- **Phone app** (`public-studio/studio.html` + `studio.js`) — gate → wizard (chips + 🎙️ Web Speech) → build → sandboxed preview.
- **Routes** (`src/routes/studio.ts`, `studio-shell.ts`) — `/studio` + `/api/studio/*` on the public host; `/preview/:token` sandboxed on the games host. Fail-closed: off until `STUDIO_CODE` set.
- In-memory sessions; ~2¢/game.

---

## 🎯 PRIORITY — Characters & Elements (image-gen + asset upload)

**James says this is THE killer function.** Today every character (hero, the good things, the
bad things) is an emoji. This lets a kid give any character a **custom look** two ways:
**🎨 Generate** (describe it → AI draws it) and **📷 Upload** (pick a photo/drawing from the phone).
Both produce the same thing: a **sprite image** embedded in the game.

### The shared sprite model (do this first — both paths need it)
- **`Sprite = { glyph?: string; img?: string }`** in `spec.ts`, where `img` is a
  `data:image/png;base64,…` URI. Render `img` if present, else `glyph`.
- **`validateSpecPatch`**: when a sprite carries `img`, assert it is exactly
  `data:image/png;base64,` + valid base64, and cap the byte length (e.g. ≤ ~400KB/sprite,
  ≤ ~1.5MB total spec). Reject anything else. (The assembler already asserts PNG-only — keep that.)
- **Kit templates** (`catcher/dodger/shooter.html`): add `drawSprite(sprite,x,y,r)` — if
  `sprite.img`, draw a **preloaded `Image`**; else `fillText(glyph)`. Preload all `img` sprites at
  game start before the loop. (Touches all 3 templates; keep them sink-free.)
- Pixel-art house style keeps sprites tiny (base64 stays small, preserves the single-file game).

### 🎨 Path A — Generate (Gemini)
- **`src/studio/art-provider.ts`** — `interface ArtProvider { generate(prompt, opts): Promise<Buffer> }`
  + `GeminiArtProvider` (Imagen / "Nano Banana"; see `compound-engineering:gemini-imagegen`
  skill). Lazy singleton like `getProvider()` in `drive.ts`. Stub impl (1×1 PNG) for keyless dev.
- **Prompt is templated, kid never controls it raw**: `"cute pixel-art game sprite of {desc},
  simple, bold, centered, on a plain {KEY_COLOR} background, kid-friendly"`. `{desc}` is the
  kid's (profanity-screened, length-capped) text. Provider safety filter ON.
- **Transparency**: Imagen has no alpha. Plan: generate on a solid **key color** (e.g. `#FF00FF`)
  and **chroma-key to transparent server-side** (needs `sharp` — see open Qs), so sprites sit on
  the game background. (Fallback: accept solid-bg sprites for v1.)
- **Route**: `POST /api/studio/session/:id/draw { slot:'hero'|'good'|'bad', index, description }`
  → generate → process → set the sprite `img` in the session spec → return ok. In-process async;
  SPA shows a "drawing…" state. **Per-kid/session image cap** (e.g. 10) — the one real cost faucet.

### 📷 Path B — Upload (the security-critical path)
- **SPA**: `<input type="file" accept="image/*" capture>` → POST the image (base64 or multipart)
  to `POST /api/studio/session/:id/asset { slot, index, image }`.
- **Server MUST re-encode, never trust the bytes**: validate magic bytes (real PNG/JPEG/WEBP —
  **reject SVG**, it carries script), then **re-encode via `sharp`**: resize to sprite size
  (~256²), strip all metadata/EXIF, output PNG. This neutralizes polyglots / EXIF / SVG-script in
  one move. Cap input bytes + dimensions before decode (decompression-bomb guard).
- Set the re-encoded base64 PNG as the sprite `img`. (Assembler's PNG-only assert is the backstop.)
- **Moderation**: uploaded/generated images can't be text-filtered. **Parent-approval gate is the
  required backstop** (see Publish phase). Optional: a vision-safety pass (Gemini/Claude vision —
  "kid-appropriate?") before it reaches the parent queue.

### Wizard ↔ SPA integration
- Add **`artSlot: 'hero'|'good'|'bad'|null`** to the `present_step` output. When set, the SPA shows
  **🎨 Draw** and **📷 Upload** buttons next to the emoji chips for that character.
- After draw/upload, the sprite is in the spec; the next build uses it.

### Cost check (AI image gen — flag before building)
- Imagen ~**$0.02/image**; ~3–6 sprites/game → **~$0.12–0.30/game**. Cap images per kid/session;
  reuse unchanged sprites across re-builds; one provider per game. Negligible at family scale.
  (Confirm live Imagen pricing + transparent-bg support at build time, per `claude-api` skill.)

### Suggested build order
1. Sprite model + template `drawSprite` (emoji still works; img renders if present) — verify a
   hand-made `img` sprite plays.
2. Upload path (sharp re-encode + route + SPA picker) — the security spine.
3. Generate path (art-provider + draw route + SPA button).
4. Wire `artSlot` into the wizard; cap + moderation hooks.

### Open questions (resolve before/while building)
- **`sharp` dependency** for re-encode + chroma-key — strongly recommended (security + transparency).
  Confirm it builds on Railway (Railpack/Nixpacks). Alt: pure-JS decode (riskier, no transparency).
- **Transparency approach**: chroma-key (sharp) vs accept solid-bg pixel sprites for v1 vs a
  transparent-capable model (gpt-image-1: has alpha but 3× cost + deprecating Oct 2026).
- **Upload moderation**: parent-gate only, or add a vision-safety pass?
- Does the kid upload directly (assumed), or KB curates? (James wants to upload → kid-upload.)

---

## ⏳ Deferred this sprint — to finish the product

- **Persistence (Postgres "workshop")** — sessions/drafts are in-memory and die on restart/redeploy.
  Move behind a small `SessionStore` interface (get/save/create) so `wizard.ts` doesn't touch a
  module global. Tables: `workshop_kids/sessions/drafts` + state machine (`schema.sql` style).
  *(Kieran review flagged the in-memory Map + lazy client as the first thing to swap here.)*
- **Publish-to-arcade + parent approval (Phase 7)** — the "and now it's saved forever" half.
  Approved game → server re-assembles from the stored spec → writes HTML to the Drive folder via a
  **separate `drive.file` writer SA** (arcade keeps read-only) → arcade discovers it in ≤60s.
  Single server-enforced approver chokepoint (extend `ADMIN_TOKEN`); a minimal approval queue UI.
  **This unlocks the real magic** ("I made a game and it's in the arcade").
- **Per-kid identity** — currently shared `STUDIO_CODE` only. Add per-kid name/PIN (mirror `gate.ts`,
  bcrypt PIN, lockout in Postgres not the in-memory limiter).
- **Iteration / "make it purple"** — re-generate a sprite/spec and re-build without starting over;
  draft versions.
- **Arcade link** — point the homepage "Make your own game ▸" at `/studio`.

---

## 🔒 Security hardening — before wider/public use

(From the security review; fine for KB-only testing now, do before exposing broadly.)
- **Move Studio to its own origin** `studio.cooldude.fun` (it's currently a path on the public
  host). Host-only, `SameSite=Strict` studio cookies; keep previews on the untrusted games origin.
- Persist PIN/gate-attempt counters in Postgres (the in-memory limiter resets on redeploy).
- `STUDIO_CODE` → real entropy (≥16 chars) once publish exists; add to prod fail-closed list.
- Route-level error mapping (don't leak SDK stack traces to a kid); session TTL/cap.
- Tighten the shell `onMessage` (`public/shell.js`) to check `e.origin`, not just `e.source`.

---

## 🔮 Future / ideas

- More kits + a **free-build** mode (same pipeline, a code-gen provider behind the spec→assemble seam).
- **Remix a friend's game**; leaderboards for kid-made games (tie into existing `scores`).
- Gemini-vs-OpenAI **art A/B** once generation lands; server-side voice fallback if Web Speech is
  weak on young voices.
- Animated/multi-frame sprites; sound packs.
