See [VALUES.md](./VALUES.md) for core values and [AGENTS.md](./AGENTS.md) for
architecture and workflows. Read both before making changes.

Quick reminder of the non-negotiables (full detail in VALUES.md):

1. Stability & consistency above all.
2. Never lose committed data (WAL + graceful shutdown; verify `integrity_check`).
3. All schema changes go through numbered migrations in `server/src/migrations/`.
4. Single Docker container serves both `/` and `/api`.
5. Bun everywhere (no npm/yarn/pnpm, no second lockfile).
6. Same-origin, no CORS.
7. Fail-fast on bad config (missing `JWT_SECRET`, failed migration).
