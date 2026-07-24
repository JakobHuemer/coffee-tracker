# Coffee Tracker — Core Values

Priority order. Read before making changes. This file is the source of truth
for project values; AGENTS.md covers architecture and workflows.

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
