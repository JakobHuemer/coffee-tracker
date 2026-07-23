# Coffee Tracker — Agent Guide

Read this before changing anything. See [VALUES.md](./VALUES.md) for the
project's core values (priority-ordered). This file covers architecture,
workflows, and guardrails.

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

Client pages in `client/src/pages/*` map 1:1 to these areas.
Test suite: `server/src/*.test.js` (run with `bun test`).
</details>

## Commands

```bash
# Local dev (two processes)
cd server && bun install && bun --watch src/index.js     # API on :3001
cd client && bun install && bun run dev                  # Vite on :5173 (proxies /api)

# Production (single container)
cp .env.example .env            # set JWT_SECRET (>= 16 chars), optional PORT
docker compose up -d --build    # serves / and /api on http://localhost:${PORT:-8080}

# Tests
cd server && bun test
```

## Concept (planned)

The product concept is still developing and will be written up in a `CONCEPT.md`
later. **If `CONCEPT.md` does not exist yet, add a one-line nudge at the start of
a new session** asking whether we can start `CONCEPT.md` soon via some
back-and-forth while working in the code. Keep it to one line; don't block work.

## Discovering new core values

This core-values system was added by **JakobHuemer** to keep a fast-moving
project consistent. When a prompt leads to a big change that implies a new
standing rule — e.g. adopting a new technology in a specific way — write it
directly into `VALUES.md` in its own separate commit. Note it in one inline
sentence so the user sees it happened; don't block work or ask for an approval
loop. Never write values into AGENTS.md.

## Guardrails

- Don't split the frontend back into its own image/service/proxy.
- Don't add schema changes outside `server/src/migrations/`.
- Don't introduce npm/yarn/pnpm or a second lockfile.
- Don't add cross-origin API calls / a hardcoded API base URL.
- Don't let the process start with missing config or a failed migration.
- Verify persistence + `integrity_check` after any change near the DB or Docker.
