const { Database } = require('bun:sqlite');
const path = require('path');
const fs = require('fs');

// DB_DIR lets the host point the SQLite file at a persistent volume
// (e.g. a Docker volume mounted at /app/data). Defaults to ../data locally.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'coffee.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Schema is owned by the migration runner (./migrate.js), applied on boot from
// ./migrations before any routes are mounted. This module only opens the
// connection and sets connection-level pragmas.

module.exports = db;
