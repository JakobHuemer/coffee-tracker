require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
app.use(cors({ origin: '*' }));
app.use(express.json());

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

// Unknown routes -> JSON 404 (keeps the API consistent instead of Express' HTML default)
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
app.listen(PORT, () => console.log(`Coffee Tracker API running on :${PORT}`));
