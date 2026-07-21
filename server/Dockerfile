# Coffee Tracker — single image. The API (Bun/Express, requires bun:sqlite)
# builds the React client in a first stage and serves the static output itself,
# so one container answers both `/` (frontend) and `/api` (backend).
#
# Build context is the REPO ROOT (needs both client/ and server/):
#   docker build -f server/Dockerfile -t coffee-tracker .

# ── Stage 1: build the frontend ───────────────────────────────────────────────
FROM oven/bun:1 AS client-build
WORKDIR /client
# Install deps first for better layer caching.
COPY client/package.json ./
RUN bun install
COPY client/ ./
# Vite reads base '/' and outputs to /client/dist.
RUN bun run build

# ── Stage 2: runtime API that also serves the built frontend ──────────────────
FROM oven/bun:1 AS runtime
WORKDIR /app
# Server deps first (layer caching), then source.
COPY server/package.json ./
RUN bun install
COPY server/ ./
# Drop the built client where index.js serves static files from (../public).
COPY --from=client-build /client/dist ./public

# The app reads process.env.PORT (falls back to 3001). DB_DIR defaults to
# /app/data — mount a volume there to persist the SQLite database.
EXPOSE 3001

CMD ["bun", "src/index.js"]
