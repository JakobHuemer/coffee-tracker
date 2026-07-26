# Coffee Tracker — Agent Guide

Read this before changing anything. See [VALUES.md](./VALUES.md) for the
project's core values (priority-ordered). This file covers architecture,
workflows, and guardrails.

## Prompts have no hidden meaning

Do exactly and only what the prompt says. No subtext to infer, no unstated
follow-up to complete.

**An action cannot be derived from a question.** A question carries no
instruction to write, so answering it is the whole job. If the answer exposes
a gap, name it — that is the response, not a licence to fix it. Same for
anything noticed in passing: report it, don't fix it unless told to.

Write only on an explicit write verb — "add", "update", "fix", "put it in",
"commit". "Why", "what", "does", "how", "when" are not.

If the expected action is unclear, stop and make the user state it before
doing anything. Never guess, and never pick the more ambitious reading.

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
- `coffees` — `GET /`, `GET|POST /entries`, `PATCH|DELETE /entries/:id`, `GET /stats`, `GET /dev-flags`
- `goals` — `GET /today`, `POST /complete`
- `achievements` `GET /` · `badges` `GET /` · `streaks` `GET /` · `rankings` `GET /` · `casualties` `GET /`
- `energy` — `GET /?hours=` (the derived Buzz score, see [docs/energy-score.md](./docs/energy-score.md))
- `challenges` — `GET /`, `POST /`, `GET /:id`, `POST /:id/join`
- `compare` — `GET /:username`
- `groups` — `GET /`, `GET /mine`, `POST /`, `POST /join`, `POST /leave`,
  `PATCH /:id`, `GET /:id` (competition groups; one per user at a time)
- `competitions` — `GET /`, `GET /leaderboard`, `POST /`, `POST /:id/join`,
  `POST /:id/leave`, `GET /:id` (see [docs/competitions-elo.md](./docs/competitions-elo.md))

Client pages in `client/src/pages/*` map 1:1 to these areas.
Test suite: `server/src/*.test.js` (run with `bun test`).
</details>

## Commands

```bash
# Local dev (two processes)
cd server && bun install && bun --watch src/index.js     # API on :3001
# Add DEV_OVERRIDES=1 to that command to enable the debug toggles on the
# Profile page (currently: bypass the 5-minute coffee spacing rule).
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

## Session log

Every session **must** maintain one file in `sessions/` — one file per session,
e.g. `sessions/YYYY-MM-DD-<short-slug>.md`. Hard cap: **100 lines, never
exceed.** If you approach the limit, tighten existing lines; don't spill.

What goes in it: only high-value context **not recorded anywhere else** — bug
catches, gotchas, non-obvious findings, dead ends, decisions that will help a
future agent. Not a diary. Skip anything derivable from code, git history, or
other docs. Underuse over overuse — most lines are noise; keep the signal.

Each file starts with frontmatter listing the **topics** it covers. A session
usually spans many topics, so this is the index: a new agent reads only the
frontmatter across `sessions/*.md` to decide which file is relevant, instead of
guessing from filenames.

```markdown
---
topics: [theme-switch, docker-volume, jwt-expiry-bug, migration-0007]
---
```

## Discovering new core values

This core-values system was added by **JakobHuemer** to keep a fast-moving
project consistent. When a prompt leads to a big change that implies a new
standing rule — e.g. adopting a new technology in a specific way — write it
directly into `VALUES.md` in its own separate commit. Note it in one inline
sentence so the user sees it happened; don't block work or ask for an approval
loop. Never write values into AGENTS.md.

## Issues & labels

Every issue carries **one `priority:`**, **one `type:`**, and optionally
`effort:`, `status:`, and `agent`. Labels are the source of truth for what to
work on and whether it is safe to start.

**Priority** (importance — pick the highest that fits):

- `priority:show-stopper` — breaks a core flow or risks data loss. Drop everything.
- `priority:high` — important, do soon.
- `priority:standard` — normal backlog.
- `priority:minor` — nice-to-have, low urgency.

**Type** (classification): `type:bug`, `type:feature`, `type:enhancement`,
`type:infra`, `type:testing`, `type:docs`, `type:chore`.

**Effort** (rough size): `effort:trivial` (<1h) · `effort:small` (half a
session) · `effort:medium` (one session) · `effort:large` (multi-session, needs
a plan first).

**Status / claim**: `status:claimed`, `status:in-progress`, `status:blocked`,
`status:needs-discussion`. `agent` marks an issue safe for an autonomous agent.

### Claim protocol (so parallel agents don't collide)

Before touching any issue an agent **must**:

1. `gh issue view <N> --json labels,assignees,title` and check for a claim.
2. **If `status:claimed` or `status:in-progress` is present (or it is assigned
   to someone else): STOP. Do not start.** Report to the user that the issue is
   already claimed and pick something else or wait.
3. Otherwise **claim it before writing any code**:
   `gh issue edit <N> --add-label status:in-progress` and
   `gh issue comment <N> --body "Claimed by <agent-id> at <UTC time>."`
4. On finish, the closing PR clears it (the merge removes the issue). If you
   **abandon** the work: `gh issue edit <N> --remove-label status:in-progress`
   and comment why, so the next agent can take it.

The label claim is best-effort, not a lock — re-check labels right before you
start committing.

### PRs must reference their issue

If a PR resolves an existing issue, it **must** reference it with a closing
keyword in the PR body: `Fixes #<N>` / `Closes #<N>` (one per issue if it spans
several). Issue-less PRs are fine — a PR does **not** need an issue created for
it; only reference an issue if one already exists.

## Never kill a process you did not start

The developer runs their own `bun run dev` (Vite) and API server in this repo.
Agents have repeatedly killed those while cleaning up their own test servers.
**A dev server dying mid-session is never acceptable collateral.**

- **Never use a pattern-matching killer.** No `pkill -f …`, no
  `kill $(pgrep …)`, no `killall bun`. Every one of these matches the
  developer's processes — and often the agent's own shell, which is why these
  commands keep exiting 144. `bun run dev`, `bun src/index.js` and the wrapper
  shell all look alike to a pattern.
- **Record the PID when you start something, and kill only that PID.**

  ```bash
  bun src/index.js > "$SCRATCH/srv.log" 2>&1 &
  SRV=$!            # the only pid you are ever allowed to kill
  kill -TERM $SRV
  ```

- **Get isolation from a fresh environment, not from killing things.** Every
  test server gets its own **unused high port** and its own **`DB_DIR` under the
  scratchpad**, never the repo's `server/data` and never the default 3001/5173.
  Two servers coexisting is fine; that is the whole point.
- Leave a stray test server running rather than risk a broad kill. Say so in the
  summary and let the developer clear it.

## Guardrails

- **Never reference a symbol that doesn't exist** — a CSS variable / design
  token, function, variable, import, or export. This is VALUES.md rule 0, the
  top-priority hard gate: such a change is **rejected outright in review**,
  regardless of everything else in it. Before committing, run typecheck **and**
  build, and grep for the exact token/function/import you introduced to confirm
  it resolves. Unverified references are unacceptable.
- Don't split the frontend back into its own image/service/proxy.
- Don't add schema changes outside `server/src/migrations/`.
- Don't introduce npm/yarn/pnpm or a second lockfile.
- Don't add cross-origin API calls / a hardcoded API base URL.
- Don't let the process start with missing config or a failed migration.
- Verify persistence + `integrity_check` after any change near the DB or Docker.
- **Prefer fetching over recall. Assume you know ~1% of any topic and that the
  rest of your "knowledge" is wrong.** Before designing, reviewing, or changing
  anything non-trivial (timezones, security, protocols, library behaviour,
  APIs), **look it up** — WebFetch/WebSearch the primary source, read the actual
  docs, or grep this repo — instead of answering from memory. State plainly when
  something is unverified recall vs. checked. Confident-sounding guesses are the
  failure mode here; a fetched citation beats a remembered "fact" every time.
- **Time / timezones:** follow [docs/time-and-timezones.md](./docs/time-and-timezones.md)
  and fetch its linked sources before touching time code.
