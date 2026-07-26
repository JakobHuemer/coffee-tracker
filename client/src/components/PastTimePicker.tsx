import { useEffect, useState } from 'react';

// The selectable range is a rolling 24-hour window ending at now — not a
// calendar day. It wraps midnight, so at 00:15 both 00:10 (today) and 23:50
// (yesterday) are inside it, which is why the day part is a toggle rather than
// something derived from the clock value alone.
const WINDOW_MS = 24 * 60 * 60 * 1000;

// Same 2-minute allowance the server uses for client/server clock skew
// (SKEW_MS in server/src/routes/coffees.js). Keeping the two equal means a
// time this picker accepts is never rejected by POST /coffees/entries.
const SKEW_MS = 2 * 60 * 1000;

export type Day = 'today' | 'yesterday';

/** What the user typed. The timestamp is derived from it, never stored. */
export type PastTime = { time: string; day: Day };

export type ResolvedTime = {
  /** Full timestamp in ms, or null while the value is unusable. */
  timestamp: number | null;
  /** Inline hint to show; null when the value is inside the window. */
  hint: string | null;
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function currentPastTime(): PastTime {
  const d = new Date();
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, day: 'today' };
}

/**
 * Resolve what the user typed against a given instant.
 *
 * Pure and takes `now` as an argument so the caller decides which instant to
 * judge against — the render pass uses a ticking clock, submit uses a fresh
 * `Date.now()`. Nothing derives this into state, so no copy of it can go stale.
 */
export function resolvePastTime({ time, day }: PastTime, now: number): ResolvedTime {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || min > 59) {
    return { timestamp: null, hint: 'Enter a time as HH:MM.' };
  }

  // "Yesterday" shifts one calendar day, not 24 hours: on a DST boundary those
  // differ by an hour, and the user means the day label, not the elapsed span.
  //
  // setHours/setDate resolve in the runtime's zone, which in the browser is the
  // user's own zone — that is exactly what a time they just typed means. The
  // ban on these in docs/time-and-timezones.md is scoped to the server, where
  // the process zone is unpinned and unrelated to any user.
  const d = new Date(now);
  if (day === 'yesterday') d.setDate(d.getDate() - 1);
  d.setHours(h, min, 0, 0);
  const timestamp = d.getTime();

  if (timestamp > now + SKEW_MS) {
    return {
      timestamp: null,
      hint: day === 'today'
        ? "That's still ahead — did you mean yesterday?"
        : "That's in the future.",
    };
  }
  if (timestamp < now - WINDOW_MS) {
    return {
      timestamp: null,
      hint: day === 'yesterday'
        ? 'More than 24h ago — did you mean today?'
        : 'More than 24h ago.',
    };
  }
  return { timestamp, hint: null };
}

/**
 * A clock that re-renders the caller on an interval, so anything derived from
 * "now" stays truthful while the form sits open — the elapsed line, and a value
 * that was inside the window at 23:59 and is not at 00:00.
 */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatElapsed(ms: number) {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m ago`;
  if (m === 0) return `${h}h ago`;
  return `${h}h ${m}m ago`;
}

/**
 * Presentational: the owner holds the value and the resolution, so the two can
 * never disagree. Nothing is pushed upward from an effect.
 */
export function PastTimePicker({ value, resolved, now, onChange }: {
  value: PastTime;
  resolved: ResolvedTime;
  now: number;
  onChange: (v: PastTime) => void;
}) {
  return (
    <div className="ptp">
      <div className="ptp-row">
        <input
          className="ptp-time"
          type="time"
          value={value.time}
          onChange={e => onChange({ ...value, time: e.target.value })}
          aria-label="Time"
          aria-invalid={resolved.hint !== null}
        />
        <div className="ptp-days" role="group" aria-label="Day">
          {(['today', 'yesterday'] as Day[]).map(d => (
            <button
              key={d}
              type="button"
              className={`ptp-day${value.day === d ? ' on' : ''}`}
              onClick={() => onChange({ ...value, day: d })}
              aria-pressed={value.day === d}
            >
              {d === 'today' ? 'Today' : 'Yesterday'}
            </button>
          ))}
        </div>
      </div>
      {resolved.hint
        ? <div className="ptp-hint">{resolved.hint}</div>
        : <div className="ptp-elapsed">{formatElapsed(now - (resolved.timestamp as number))}</div>}
    </div>
  );
}
