# Coffee Tracker — Agent Guide

Read this before changing anything. These are the project's values, in priority
order, plus the architecture and workflows that enforce them.

## Core values (priority order)

1. **Stability & consistency above all.** This app should just run, for a long
   time, without surprises. Prefer boring, proven approaches over clever ones.
   "Code quality" polish is not a goal in itself — a stable, predictable system
   is. Keep behavior consistent across restarts, rebuilds, and releases.

2. **Never lose committed data.** The SQLite DB is the source of truth and must
   survive crashes, restarts, redeploys, and hard kills.
   - SQLite runs in **WAL mode** (`server/src/db.js`).
   - The process handles **SIGTERM/SIGINT** gracefully (closes server + DB) so
     restarts are clean (`server/src/index.js`).
   - Any change touching persistence must preserve: `PRAGMA integrity_check` =
     `ok` after a `docker kill -9`, and zero loss of committed rows.

3. **DB migrations for every schema change.** Never hand-edit the schema or add
   inline `ALTER`/`CREATE` at boot. All schema lives in numbered migrations.
   - Runner: `server/src/migrate.js` (runs on boot, before routes mount).
   - Migrations: `server/src/migrations/NNN_description.js`, each exporting
     `up(db)`. Applied in ascending numeric order, each recorded atomically in
     `schema_migrations`. A failed migration aborts the process (fail-fast).
   - **To add a schema change:** create the next-numbered file (e.g.
     `004_add_x.js`) with an `up(db)`. Make it idempotent/guarded where
     reasonable. If it must control its own transaction or toggle PRAGMAs (like
     `003_drop_email_column.js` does for `foreign_keys`), set
     `exports.manualTransaction = true`. Never renumber or edit an
     already-shipped migration — only add new ones.

4. **Single Docker container.** One image serves BOTH the frontend (`/`) and the
   API (`/api`). No separate frontend image, no proxy container.
   - `server/Dockerfile` is multi-stage, built from the **repo root**: stage 1
     builds the Vite client → `/client/dist`; stage 2 (Bun/Express) copies it to
     `./public` and serves it with an SPA fallback.
   - One compose service (`docker-compose.yaml`), one published port. Don't
     reintroduce a second service/image for the frontend.

5. **Bun everywhere.** The server runs on Bun (required for `bun:sqlite`), and
   the client is built with Bun. Use `bun install` / `bun run`, not npm/yarn/pnpm.
   Do not add `package-lock.json`/`yarn.lock`; `bun.lock` is the lockfile.

6. **Same-origin, no CORS.** Frontend and API share one origin/port, so the
   client calls `/api` relatively (`client/src/api/client.ts`). Do not
   reintroduce a cross-origin setup or a baked-in absolute API URL. Keep it
   same-origin so there is no CORS surface to manage.

7. **Fail-fast on bad config.** Refuse to start rather than run degraded:
   missing/weak `JWT_SECRET` exits (`server/src/index.js`); a failed migration
   exits; compose requires `JWT_SECRET` via `${JWT_SECRET:?...}`. Preserve this —
   never silently fall back to insecure or half-migrated states.

## Architecture at a glance

- `server/` — Bun + Express API. `src/index.js` (boot: config check → migrate →
  routes → static frontend → graceful shutdown), `src/db.js` (open + pragmas),
  `src/migrate.js` + `src/migrations/`, `src/routes/*`, `src/data/*` (static
  seed data, read-only).
- `client/` — React 19 + Vite + TS. Built into the image, not deployed
  separately. `base: '/'`.
- DB persists on a named volume at `DB_DIR` (default `/app/data`).
- TLS is out of scope here — a reverse proxy in front terminates it.

<details>
<summary>Route surface (all under <code>/api</code>, JWT auth except register/login)</summary>

Gamification/reference data (achievements, badges, tasks, coffee catalog) lives
in `server/src/data/*.js` (static). Endpoints:

- `auth` — `POST /register`, `POST /login`, `GET|PATCH /me`
- `coffees` — `GET /`, `GET|POST /entries`, `PATCH|DELETE /entries/:id`, `GET /stats`
- `goals` — `GET /today`, `POST /complete`
- `achievements` `GET /` · `badges` `GET /` · `streaks` `GET /` · `rankings` `GET /` · `casualties` `GET /`
- `challenges` — `GET /`, `POST /`, `GET /:id`, `POST /:id/join`
- `compare` — `GET /:username`

Client pages in `client/src/pages/*` map 1:1 to these areas. There is **no test
suite** — verify changes via `docker compose` + `PRAGMA integrity_check` (see
Core value #2).
</details>

## Commands

```bash
# Local dev (two processes)
cd server && bun install && bun --watch src/index.js     # API on :3001
cd client && bun install && bun run dev                  # Vite on :5173 (proxies /api)

# Production (single container)
cp .env.example .env            # set JWT_SECRET (>= 16 chars), optional PORT
docker compose up -d --build    # serves / and /api on http://localhost:${PORT:-8080}
```

## Concept (planned)

The product concept is still developing and will be written up in a `CONCEPT.md`
later. **If `CONCEPT.md` does not exist yet, add a one-line nudge at the start of
a new session** asking whether we can start `CONCEPT.md` soon via some
back-and-forth while working in the code. Keep it to one line; don't block work.

## Discovering new core values

This core-values system was added by **JakobHuemer** to make developing this
project easier — it moves fast, and capturing values as they emerge keeps it
consistent. So it is a deliberate process, not noise.

When a prompt leads to a **big change or a possible new core value** — e.g.
adopting a new technology and using it in some way — do NOT silently absorb it.
Flag it to the user (the person prompting you) so it can be recorded:

- **Notice it clearly.** Reference the flag on the **first line and the last
  line** of your response, so it can't be missed among the main work.
- **Still do the main work.** The value flag is a side note; the user's actual
  request stays the focus.
- **Ask kindly for a decision in their next prompt** — approve / modify / deny —
  alongside whatever else they say. Include a one-line statement of what the
  core value would be.

Example (main task was something else; a new value surfaced):

> 🧭 **Possible new core value discovered** — flagged per the core-values system
> (added by JakobHuemer to keep this fast-moving project consistent).
>
> *…[the actual requested work, done normally]…*
>
> > **New core value?** "Redis is a cache-aside layer only — never a source of truth."
> > Reply **approve / modify / deny** in your next message, alongside anything else.
>
> 🧭 New core value awaiting your approve/modify/deny (see top). — *core-values
> system by JakobHuemer.*

If the user responds to **add/modify** the value, reply with an ultra-short
prompt containing ONLY the core value and a short header — nothing else:

> **Add to AGENTS.md?**
> > "Redis is a cache-aside layer only — never a source of truth."
>
> approve / update / dismiss?

**Committing an approved value:** write it into this file as its own **complete,
separate commit** (just the value addition) — but to the user, treat it as a
side thing that happened during the main goal, not a ceremony.

## Guardrails

- Don't split the frontend back into its own image/service/proxy.
- Don't add schema changes outside `server/src/migrations/`.
- Don't introduce npm/yarn/pnpm or a second lockfile.
- Don't add cross-origin API calls / a hardcoded API base URL.
- Don't let the process start with missing config or a failed migration.
- Verify persistence + `integrity_check` after any change near the DB or Docker.
