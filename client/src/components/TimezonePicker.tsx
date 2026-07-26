import { useState, useMemo, useRef, useEffect } from 'react';
import { Icon } from './Icon';

// Every IANA zone the runtime knows about. `Intl.supportedValuesOf` does not
// include "UTC" (it lists Etc/UTC instead), but UTC is what the server falls
// back to and stores, so a group already on it must still be able to find and
// keep its own value — hence the explicit prepend.
function listZones(): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Very old runtime: offer at least the device's own zone rather than nothing.
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    zones = own ? [own] : [];
  }
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

// "GMT+2" for a zone, right now. Only ever called for the handful of rows on
// screen — doing it for all 418 zones on every keystroke would be wasteful.
function offsetLabel(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(Date.now())
      .find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

// Fuzzy match, lower score = better, null = no match.
//
// A substring hit always beats a scattered one ("york" should put New_York
// first, not Europe/Kyiv). Failing that, the query has to appear in order as a
// subsequence, scored by how far it had to scatter.
function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  const haystack = text.toLowerCase().replace(/_/g, ' ');
  const needle = query.toLowerCase().replace(/_/g, ' ').trim();
  if (!needle) return 0;

  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct;

  let cursor = 0;
  let gaps = 0;
  let first = -1;
  for (const ch of needle) {
    if (ch === ' ') continue;
    const found = haystack.indexOf(ch, cursor);
    if (found < 0) return null;
    if (first < 0) first = found;
    gaps += found - cursor;
    cursor = found + 1;
  }
  // Offset past every substring score so a real substring hit always wins.
  return 1000 + gaps + first;
}

const MAX_RESULTS = 60;

export function TimezonePicker({ value, onChange, id }: {
  value: string;
  onChange: (zone: string) => void;
  id?: string;
}) {
  const zones = useMemo(listZones, []);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const scored: Array<{ zone: string; score: number }> = [];
    for (const zone of zones) {
      const score = fuzzyScore(zone, query);
      if (score !== null) scored.push({ zone, score });
    }
    scored.sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone));
    return scored.slice(0, MAX_RESULTS).map(s => s.zone);
  }, [zones, query]);

  // Click outside closes without committing — the field keeps the stored value.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(zone: string) {
    onChange(zone);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive(i => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.max(0, Math.min(results.length - 1, next));
      });
    } else if (e.key === 'Enter') {
      if (open && results[active]) { e.preventDefault(); choose(results[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="tzp" ref={wrapRef}>
      <input
        id={id}
        className="search-input"
        // Closed, the field reads as the stored zone; open, it is a search box.
        value={open ? query : value}
        placeholder={value}
        onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="tzp-list"
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />

      {open && (
        <div className="tzp-list" id="tzp-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="tzp-empty">No zone matches.</div>}
          {results.map((zone, i) => (
            <button
              key={zone}
              type="button"
              role="option"
              aria-selected={zone === value}
              data-active={i === active}
              className={`tzp-opt${i === active ? ' active' : ''}`}
              // mousedown, not click: the input's blur would otherwise close the
              // list before the click landed.
              onMouseDown={e => { e.preventDefault(); choose(zone); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="tzp-zone">{zone.replace(/_/g, ' ')}</span>
              <span className="tzp-offset">{offsetLabel(zone)}</span>
              {zone === value && <Icon name="check" size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
