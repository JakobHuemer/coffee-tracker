// Time translation boundary — the ONLY place the instant (UTC epoch) domain and
// the civil (zoned calendar) domain meet. See docs/time-and-timezones.md.
//
// Instant domain: epoch milliseconds, UTC. Absolute, timezone-free.
// Civil domain:   "what local day/hour is it for this user", needs an IANA zone.
//
// Uses Intl.DateTimeFormat (zero-dep, applies the IANA tz database incl. DST).
// Never use Date.getHours()/setHours() for civil logic — those use the process
// zone, not the user's.

const DEFAULT_TZ = 'UTC';

// Cache one formatter per zone (constructing them is relatively expensive).
const _fmtCache = new Map();
function fmt(tz) {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

// True if tz is a usable IANA zone name (e.g. "Europe/Vienna"). Rejects offsets,
// abbreviations, and garbage.
function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Break an instant into its civil parts in the given zone.
function localParts(instant, tz) {
  const m = {};
  for (const p of fmt(tz).formatToParts(instant)) {
    if (p.type !== 'literal') m[p.type] = Number(p.value);
  }
  return { year: m.year, month: m.month, day: m.day, hour: m.hour, minute: m.minute, second: m.second };
}

// "YYYY-MM-DD" for an instant, in the user's zone.
function localDateStr(instant, tz) {
  const p = localParts(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Today's civil date in the user's zone.
function localTodayStr(tz) {
  return localDateStr(Date.now(), tz);
}

// The zone's UTC offset (ms) at a given instant — derived per-instant so DST is
// accounted for automatically.
function offsetMs(instant, tz) {
  const p = localParts(instant, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - instant;
}

// Convert a local wall-clock (dateStr + "HH:MM:SS" in the user's zone) to the
// real UTC instant. Two-pass so the offset is taken at the resolved instant,
// which is correct across DST boundaries.
function localWallInstant(dateStr, timeStr, tz) {
  const wallAsUTC = Date.parse(`${dateStr}T${timeStr}Z`);
  let inst = wallAsUTC - offsetMs(wallAsUTC, tz);
  inst = wallAsUTC - offsetMs(inst, tz);
  return inst;
}

// The day after a "YYYY-MM-DD" string (UTC-safe date arithmetic on the label).
function nextDayStr(dateStr) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

// [start, end] instants (UTC epoch ms) covering the whole local calendar day
// `dateStr` in the user's zone. end is inclusive (last ms of the day).
function localDayBounds(dateStr, tz) {
  const start = localWallInstant(dateStr, '00:00:00', tz);
  const end = localWallInstant(nextDayStr(dateStr), '00:00:00', tz) - 1;
  return { start, end };
}

// Look up a user's stored IANA zone, falling back to UTC if missing/invalid.
function getUserTz(db, userId) {
  const row = db.prepare('SELECT timezone FROM users WHERE id = ?').get(userId);
  return row && isValidTz(row.timezone) ? row.timezone : DEFAULT_TZ;
}

module.exports = {
  DEFAULT_TZ, isValidTz, localParts, localDateStr, localTodayStr,
  offsetMs, localWallInstant, localDayBounds, getUserTz,
};
