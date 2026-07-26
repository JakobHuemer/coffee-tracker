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

type Day = 'today' | 'yesterday';

export type PastTimeState = {
  /** Full timestamp in ms, or null while the value is unusable. */
  timestamp: number | null;
  /** Inline hint to show; null when the value is inside the window. */
  hint: string | null;
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Combine an HH:MM value and a day choice into a timestamp.
 *
 * "Yesterday" shifts one calendar day, not 24 hours: on a DST boundary those
 * differ by an hour, and the user means the day label, not the elapsed span.
 */
function combine(time: string, day: Day): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;

  const d = new Date();
  if (day === 'yesterday') d.setDate(d.getDate() - 1);
  d.setHours(h, min, 0, 0);
  return d.getTime();
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

export function PastTimePicker({ onChange }: { onChange: (s: PastTimeState) => void }) {
  const [time, setTime] = useState(nowHHMM);
  const [day, setDay] = useState<Day>('today');
  // Re-render on a timer so the elapsed line stays truthful while the form is
  // open, and so a value that was valid at 23:59 turns into a hint at 00:00.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const ts = combine(time, day);

  let hint: string | null = null;
  if (ts === null) {
    hint = 'Enter a time as HH:MM.';
  } else if (ts > now + SKEW_MS) {
    hint = day === 'today'
      ? "That's still ahead — did you mean yesterday?"
      : "That's in the future.";
  } else if (ts < now - WINDOW_MS) {
    hint = day === 'yesterday'
      ? 'More than 24h ago — did you mean today?'
      : 'More than 24h ago.';
  }

  const valid = ts !== null && hint === null;

  useEffect(() => {
    onChange({ timestamp: valid ? ts : null, hint });
    // `tick` is a dependency because validity is time-dependent: the same
    // time + day pair can fall out of the window with no user input at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, hint, valid, tick]);

  return (
    <div className="ptp">
      <div className="ptp-row">
        <input
          className="ptp-time"
          type="time"
          value={time}
          onChange={e => setTime(e.target.value)}
          aria-label="Time"
          aria-invalid={hint !== null}
        />
        <div className="ptp-days" role="group" aria-label="Day">
          {(['today', 'yesterday'] as Day[]).map(d => (
            <button
              key={d}
              type="button"
              className={`ptp-day${day === d ? ' on' : ''}`}
              onClick={() => setDay(d)}
              aria-pressed={day === d}
            >
              {d === 'today' ? 'Today' : 'Yesterday'}
            </button>
          ))}
        </div>
      </div>
      {hint
        ? <div className="ptp-hint">{hint}</div>
        : <div className="ptp-elapsed">{formatElapsed(now - (ts as number))}</div>}
    </div>
  );
}
