# Coffee Tracker

Track your coffees and caffeine, with goals, streaks, achievements, badges,
challenges, rankings, and head-to-head comparisons. Bun + Express + SQLite API
that also serves a React (Vite) frontend — **one Docker container, one port**.

## Getting Started

To start tracking coffee right now, just create an account at [coffee.fistel.dev](http://coffee.fistel.dev).


## Quickstart

```bash
cp .env.example .env          # set JWT_SECRET (>= 16 chars); optional PORT
docker compose up -d --build  # serves / and /api on http://localhost:${PORT:-8080}
```

Put your own TLS-terminating reverse proxy in front of that port.

### Local dev

```bash
cd server && bun install && bun --watch src/index.js   # API on :3001
cd client && bun install && bun run dev                # Vite on :5173 (proxies /api)
```

## Stack

- **Backend:** Bun + Express, `bun:sqlite`. Schema via numbered migrations
  (`server/src/migrations/`), applied on boot.
- **Frontend:** React 19 + Vite + TypeScript, built into the same image and
  served by the backend (same-origin `/api`, no CORS).
- **Data:** SQLite on a named volume (`db-data:/app/data`), persists across
  restarts/rebuilds.

## Contributing

Read **[AGENTS.md](./AGENTS.md)** first — it holds the project's core values
(stability, data safety, migrations, single container, Bun, same-origin,
fail-fast) and the workflows that enforce them. It is the source of truth for
how to work in this repo.
