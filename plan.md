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
- [x] Subagent (`general-purpose`): all 5 checks PASS, no data-loss bug found. Adopted its one non-blocking suggestion — sort migrations by numeric version, not filename string.
- [x] Claude ran harness (`scratchpad/gate1.js`): 11/11 PASS — fresh schema (normalized SQL + every-table `table_info`) matches pre-change db.js, `schema_migrations`=[1,2,3], idempotent 2nd run, bootstrap w/o email marks [1,2,3] & preserves rows, bootstrap w/ email drops column + preserves user + child rows NOT cascade-deleted.
- [x] Claude booted real server (deps installed): clean boot, health `{"ok":true}`, rows [1,2,3]; restart idempotent (still 3 rows, no re-apply).
- [x] Committed to main (53f5132).

## Phase 2 — DB persistence path
- [x] Confirmed `DB_DIR` defaults to `/app/data` in-container (db.js: `path.join(__dirname,'..','data')`, `__dirname=/app/src`). `.dockerignore` excludes `data`.
- [x] Confirmed `server/src/data/*.js` are pure static seed exports — no DB access, no file writes at runtime.
- Note: container ignores SIGTERM → docker SIGKILL after 10s (no graceful-shutdown handler). Not data-loss (WAL/committed). Candidate for Phase 5 stability polish.

**Gate 2**
- [x] Claude ran persistence proof: built `./server` image, registered user `persisto` (id `0334f269…`) on named volume, `docker rm -f` container A, fresh container B on SAME volume → login succeeded with identical user id. PASS.
- [x] Subagent (`general-purpose`, docker): independent PASS — user id `d731803e…` identical across container A→B on the volume. Both proofs agree.
- [x] Committed plan update (no source changed this phase).

## Phase 3 — Single-container build: backend serves frontend
- [x] `server/Dockerfile` multi-stage (repo-root context, `-f server/Dockerfile`): stage `client-build` builds client → `/client/dist`; stage `runtime` installs server deps, copies server source, `COPY --from=client-build /client/dist ./public`. Added root `.dockerignore`.
- [x] `server/src/index.js`: unknown `/api/*` → JSON 404 (mounted first); `express.static(./public)` when present; `app.get('*')` SPA fallback → index.html; final JSON 404 catch-all for non-GET/no-frontend. Guarded by `fs.existsSync(public/index.html)` so API-only dev runs still work.
- [x] `client/src/api/client.ts`: relative `/api` default confirmed correct (same-origin). (Railway comment already dropped in Phase 0.)
- [x] `client/package-lock.json` deleted (Phase 0). Also removed dead GH Pages SPA hack (`client/public/404.html` + redirect script in `client/index.html`) — server-side SPA fallback makes it obsolete.

**Gate 3**
- [x] Claude built + ran the single image: `/`→index.html(200), deep route→same index.html (SPA OK), `/health`→`{"ok":true}`, `/api/nonsense`→JSON 404, asset `/assets/index-*.js`→200 js, no `/coffee-tracker/` base (earlier "FOUND" was a `|head` false-positive; verified clean).
- [x] Subagent (`general-purpose`, docker): independent PASS on all 8 checks (build, `/`, deep SPA route byte-identical, `/api/nonsense` JSON 404, asset load, no `/coffee-tracker/`, cleanup).
- [ ] **User (browser)**: open the running container's port, click around the actual app (log a coffee, refresh on a deep route), confirm it behaves like the current split deployment. Confirm back.

## Phase 4 — Compose + final wiring
- [x] `docker-compose.yaml` at repo root: single service `app` (context `.`, `dockerfile: server/Dockerfile`), named volume `db-data:/app/data`, `JWT_SECRET` from `.env` (fails loudly via `:?` if unset), host `${PORT:-8080}:3001`, `restart: unless-stopped`.
- [x] `.env.example` at root: `JWT_SECRET`, `PORT`. Added `!.env.example` exception to `.gitignore` (was masked by `.env.*`).

**Gate 4**
- [x] Subagent (`general-purpose`, docker): PASS all stages — user id `d03814a9…` identical across register→me→restart→down/up; single port serves `/health`+`/`+`/api` same-origin (no CORS); volume destroyed only by `down -v`. (Host provider is podman-compose via `docker` alias — works.)
- [ ] **User (browser + deploy)**: run `docker compose up -d`, log some coffees through the actual UI, `docker compose restart`, refresh the page, confirm your data is still there. Confirm back.

## Phase 5 — Full stability sign-off
- [x] Added graceful SIGTERM/SIGINT shutdown to `server/src/index.js` (close server + db, 5s hard cap) — fixes the ~10s SIGKILL delay flagged by every gate.
- [x] `client/.dockerignore` not needed — root `.dockerignore` already excludes `**/node_modules` + `**/dist`, so the client build stage copies clean source.
- [x] Smoke-test every route group + WAL kill-9 integrity — Gate 5 subagent PASS.

**Gate 5**
- [x] Subagent (`general-purpose`, docker): PASS all — every route group 200 (no 5xx), graceful shutdown stops in 0.48s (no SIGKILL), `PRAGMA integrity_check`="ok" after `docker kill -9`, coffee entries 8→8 (no committed rows lost), user survived.
- [ ] **User (final sign-off)**: does the app feel done? Anything from the old split-deploy setup missing (env vars, behavior) that you relied on? Confirm back before calling this closed.

---

## Files touched (representative, not exhaustive)
- **Delete**: `src/index.ts`, `package.json` (root), `tsconfig.json` (root), `index.html` (root), `server/railway.json`, `.github/workflows/deploy.yml`, `client/package-lock.json`
- **New**: `server/src/migrate.js`, `server/src/migrations/001_init.js`, `002_add_featured_badges.js`, `003_drop_email_column.js`, `docker-compose.yaml`, `.env.example`
- **Edit**: `server/src/db.js` (strip inline migrations, keep pragmas/open only), `server/src/index.js` (call migrate before routes; serve static + SPA fallback after `/api/*`, before JSON 404 catch-all), `server/Dockerfile` (multi-stage: build client, copy dist into runtime image), `client/vite.config.ts` (base `/`), `client/src/api/client.ts` (drop Railway comment)

End state: **one Docker image, one compose service, one port.** No separate client image/service, no proxy container.
