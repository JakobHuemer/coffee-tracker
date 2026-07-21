# Coffee Tracker → Docker Compose Rewrite Plan

## Context

App currently split: backend (`server/`, Express+Bun+bun:sqlite) deployed to Railway, frontend (`client/`, React+Vite) deployed to GitHub Pages, cross-origin via `VITE_API_URL` baked at build time. Dead scaffold at repo root (`src/index.ts`, root `package.json`/`tsconfig.json`, standalone `index.html` prototype — localStorage-only, no backend, superseded by `client/`).

**Target, explicitly: ONE container, ONE image.** Backend (Bun/Express) builds the client as a Docker build stage and serves the built static files itself, defaulting `/api` calls to itself. No second frontend container, no proxy container. Railway fully removed, TLS out of scope (user handles it externally).

User's explicit priorities, in order:
1. **Stability over everything.** No "code quality" gate — gates check the app actually works and doesn't lose data.
2. **DB must persist across container/server restarts** (`DB_DIR` env hook exists at `server/src/db.js:8` — needs a real volume wired into compose).
3. **Lightweight migration system** so schema can keep evolving safely — replacing the current ad-hoc inline `ALTER TABLE`/rebuild blocks in `server/src/db.js`.

**Auth**: already username/password only (verified in `server/src/routes/auth.js` — no email field anywhere, migration `003` in the plan already ports the historical email→username rebuild). No code change needed here, confirmed while writing this plan.

**Quality gates**: each phase ends with a subagent that statically reviews / runs the actual code/config produced (not "code quality," but correctness: does the logic do what the phase claims, are there gaps that would lose data or break at runtime).

**Gate execution rules**:
- Simple shell checks (grep, running a script, `bun` command, `docker` build/run, curl) are run by Claude directly — NOT handed to the user.
- Only **browser navigation** (clicking through the actual UI) and **actual deployment** are handed to the user to do manually and confirm back.
- Each phase is **committed** once its gate passes (branch off `main` if on `main`; commit message per phase).

---

## Phase 0 — Remove dead weight
- [x] Delete root `src/`, root `package.json`, root `tsconfig.json` (dead scaffold)
- [x] Delete root `index.html` (superseded localStorage prototype — confirmed for deletion)
- [x] Remove `server/railway.json`
- [x] Remove Railway-specific comments in `server/Dockerfile`, `server/src/db.js`, `client/src/api/client.ts`
- [x] Remove `.github/workflows/deploy.yml` (GitHub Pages deploy)
- [x] `client/vite.config.ts`: `base: '/coffee-tracker/'` → `/`

**Gate 0**
- [x] Subagent (`general-purpose`, read-only): all checks PASS — files removed, zero leftover `railway`/`github-pages` refs outside `plan.md`, `base: '/'` confirmed.
- [x] Grep re-run by Claude: `grep -rin railway .` (excl. plan.md) + `grep -rn "coffee-tracker/" client/` → zero hits.
- [x] Committed.

## Phase 1 — Migration system (server)
- [x] New table `schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`
- [x] New `server/src/migrations/001_init.js` — full schema (historically without `featured_badges`), as `up(db)`
- [x] New `server/src/migrations/002_add_featured_badges.js` — ports the `featured_badges` add-column migration (guarded/idempotent)
- [x] New `server/src/migrations/003_drop_email_column.js` — ports the email→username table rebuild (`manualTransaction` — owns its own txn + FK-toggle; no-op when no email col)
- [x] New `server/src/migrate.js` — runner: applies un-recorded migrations in ascending order, migration+record atomic in one txn (003 exempt), rejects duplicate versions, **aborts process on any failure** (process.exit(1))
- [x] Bootstrap compatibility: no `schema_migrations` but `users` exists → mark 1-3 applied only where end-state already holds (1 always; 2 iff `featured_badges` col; 3 iff `email` gone). Legacy DB still carrying `email` correctly runs 003.
- [x] `server/src/db.js`: stripped to open DB + pragmas only; schema now owned by `001_init.js`
- [x] `server/src/index.js`: `require('./db')` + `require('./migrate')(db)` before mounting routes

**Gate 1**
- [ ] Subagent (`general-purpose`): reviews runner + migration data-safety. *(running)*
- [x] Claude ran harness (`scratchpad/gate1.js`): 11/11 PASS — fresh schema (normalized SQL + every-table `table_info`) matches pre-change db.js, `schema_migrations`=[1,2,3], idempotent 2nd run, bootstrap w/o email marks [1,2,3] & preserves rows, bootstrap w/ email drops column + preserves user + child rows NOT cascade-deleted.
- [x] Claude booted real server (deps installed): clean boot, health `{"ok":true}`, rows [1,2,3]; restart idempotent (still 3 rows, no re-apply).
- [ ] Commit on subagent pass.

## Phase 2 — DB persistence path
- [ ] Confirm `DB_DIR` defaults to a path that will be volume-mounted (e.g. `/app/data`)
- [ ] Confirm nothing else under `server/src/data/*.js` is written to at runtime (those are static seed modules, read-only)

**Gate 2**
- [ ] Subagent (`general-purpose`, Bash): builds backend image alone, runs it with a named volume at the DB path, writes data via API, stops/removes container (keeps volume), starts a fresh container on same volume, confirms data survived. Reports pass/fail with the exact commands used.
- [ ] Claude confirms the subagent's persistence proof; commit on pass. (No user action — pure shell/docker.)

## Phase 3 — Single-container build: backend serves frontend
- [ ] `server/Dockerfile` becomes multi-stage:
  - Stage `client-build` (`oven/bun:1`): copy `client/`, `bun install`, `bun run build` → `client/dist`
  - Stage `runtime` (`oven/bun:1`): server deps via `bun install`, copy server source, `COPY --from=client-build /client/dist ./public`
- [ ] `server/src/index.js`: serve `./public` via static middleware, mounted **after** all `/api/*` routes; add SPA fallback for non-`/api` unmatched routes (serves `index.html` for client-side React Router paths) placed before the existing JSON 404 catch-all, which now only applies to `/api/*`
- [ ] `client/src/api/client.ts`: drop Railway comment (Phase 0), keep `BASE = import.meta.env.VITE_API_URL || '/api'` — relative default is now correct for prod (same origin), `VITE_API_URL` becomes dev-only/optional
- [ ] Delete `client/package-lock.json` (Bun-only now, build happens inside the Docker build stage)

**Gate 3**
- [ ] Subagent (`general-purpose`, Bash): builds the single image, runs it, curls `/` (expect built `index.html`), curls a deep SPA route like `/some/route` (expect `index.html` fallback, not 404), curls `/api/health` (expect JSON), curls `/api/nonsense` (expect JSON 404 — ordering check), confirms no asset references the old `/coffee-tracker/` base.
- [ ] **User (browser)**: open the running container's port, click around the actual app (log a coffee, refresh on a deep route), confirm it behaves like the current split deployment. Confirm back.

## Phase 4 — Compose + final wiring
- [ ] `docker-compose.yaml` at repo root: single service `app`, builds `server/` (the multi-stage Dockerfile), named volume `db-data:/app/data` (or wherever `DB_DIR` resolves), env `JWT_SECRET` from `.env`, single published port, `restart: unless-stopped`
- [ ] `.env.example` at root: `JWT_SECRET`, `PORT`

**Gate 4**
- [ ] Subagent (`general-purpose`, Bash): `docker compose up -d` from clean state, confirms container healthy, single port reachable, `/health` + real `/api` call + `/` all work same-origin with no CORS involved; `docker compose restart` then re-checks DB data survived; `docker compose down` (no `-v`) then `up` again, re-checks again. Reports logs on any failure.
- [ ] **User (browser + deploy)**: run `docker compose up -d`, log some coffees through the actual UI, `docker compose restart`, refresh the page, confirm your data is still there. Confirm back.

## Phase 5 — Full stability sign-off
- [ ] Smoke-test every route group through the single port: `auth`, `coffees`, `goals`, `achievements`, `badges`, `streaks`, `challenges`, `rankings`, `compare`, `casualties`
- [ ] Confirm WAL mode (`server/src/db.js`) protects against corruption if the process is killed mid-write
- [ ] Add `client/.dockerignore` if a client build context still needs one (likely folded into `server/`'s build context / `.dockerignore` instead, since client is now just a build stage input)

**Gate 5**
- [ ] Subagent (`general-purpose`, Bash): runs the full smoke script above, force-kills the container mid-write (`docker kill`), restarts via compose, runs `PRAGMA integrity_check` against the DB file, confirms no corruption and no silently-lost committed rows. Reports pass/fail with specifics — this is the final sign-off.
- [ ] **User (final sign-off)**: does the app feel done? Anything from the old split-deploy setup missing (env vars, behavior) that you relied on? Confirm back before calling this closed.

---

## Files touched (representative, not exhaustive)
- **Delete**: `src/index.ts`, `package.json` (root), `tsconfig.json` (root), `index.html` (root), `server/railway.json`, `.github/workflows/deploy.yml`, `client/package-lock.json`
- **New**: `server/src/migrate.js`, `server/src/migrations/001_init.js`, `002_add_featured_badges.js`, `003_drop_email_column.js`, `docker-compose.yaml`, `.env.example`
- **Edit**: `server/src/db.js` (strip inline migrations, keep pragmas/open only), `server/src/index.js` (call migrate before routes; serve static + SPA fallback after `/api/*`, before JSON 404 catch-all), `server/Dockerfile` (multi-stage: build client, copy dist into runtime image), `client/vite.config.ts` (base `/`), `client/src/api/client.ts` (drop Railway comment)

End state: **one Docker image, one compose service, one port.** No separate client image/service, no proxy container.
