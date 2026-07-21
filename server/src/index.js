require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

// Fail fast rather than signing/verifying tokens with an undefined or weak
// secret. Tokens are only as trustworthy as this value, so it must be provided.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('FATAL: JWT_SECRET must be set to a strong value (>= 16 chars). Refusing to start.');
  process.exit(1);
}

// Apply pending DB migrations before mounting anything. This opens the DB and
// brings the schema up to date (or aborts the process on failure), so no route
// ever runs against a stale/half-migrated schema.
const db = require('./db');
require('./migrate')(db);

const app = express();

// Same-origin by design (AGENTS.md #6): the API is only called from the
// frontend served by this same process, so no CORS middleware — browsers'
// same-origin policy then blocks other sites from reading API responses.
app.disable('x-powered-by');

// A TLS-terminating reverse proxy sits in front of this container, so trust
// exactly one proxy hop for req.ip (used by the auth rate limiter). Set
// TRUST_PROXY=0 if the container port is exposed directly.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// Largest legitimate request body is a small JSON object; anything bigger is
// junk or abuse.
app.use(express.json({ limit: '10kb' }));

// Baseline security headers (kept manual and minimal rather than pulling in a
// framework — nothing here can break the SPA).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Lightweight liveness probe for the platform health check. Must not touch the
// DB or auth so a green check means "the process is up and serving".
app.get('/health', (req, res) => res.json({ ok: true }));

// Routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/coffees',     require('./routes/coffees'));
app.use('/api/goals',       require('./routes/goals'));
app.use('/api/achievements',require('./routes/achievements'));
app.use('/api/badges',      require('./routes/badges'));
app.use('/api/streaks',     require('./routes/streaks'));
app.use('/api/challenges',  require('./routes/challenges'));
app.use('/api/rankings',    require('./routes/rankings'));
app.use('/api/compare',     require('./routes/compare'));
app.use('/api/casualties',  require('./routes/casualties'));

// Unknown /api/* paths must always be a JSON 404 — never fall through to the
// SPA fallback below. Mounted before the static handler so the API contract
// stays consistent (no HTML served for a mistyped endpoint).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve the built frontend. In the Docker image the client build is copied to
// ../public (see server/Dockerfile). When it's absent (API-only dev run) these
// handlers are simply skipped and unmatched routes fall to the JSON 404 below.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
  // SPA fallback: any other GET returns index.html so client-side (React
  // Router) routes resolve on a hard refresh / deep link.
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

// Final catch-all: no built frontend, or a non-GET to an unknown non-API path.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  // Malformed JSON bodies are a client error, not a server error.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`Coffee Tracker API running on :${PORT}`));

// Graceful shutdown: stop accepting connections, close the DB, exit. Without
// this the container ignores SIGTERM and the runtime SIGKILLs it after ~10s on
// every `docker stop` / `compose restart`. A hard 5s cap guarantees we still
// exit even if a connection hangs.
function shutdown(signal) {
  console.log(`${signal} received — shutting down.`);
  server.close(() => {
    try { db.close(); } catch (_) { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
