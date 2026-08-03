import { useState, useMemo, useRef, useEffect } from 'react';

// A text input that offers autosuggestions but never forces one — whatever the
// admin types is the value (issue #77, for the coffee catalog's icon/class
// keys). This is the free-text sibling of TimezonePicker, which commits only a
// chosen zone; here the field is a plain controlled input and the dropdown is
// just a shortcut to a known key.
//
// Match is a simple case-insensitive substring, ranked by where the hit lands
// so a prefix match sorts first. The suggestion list is small (dozens of keys),
// so nothing fancier is needed.
function rank(option: string, query: string): number | null {
  if (!query) return 0;
  const i = option.toLowerCase().indexOf(query.toLowerCase());
  return i < 0 ? null : i;
}

const MAX_RESULTS = 40;

export function SuggestInput({
  value, onChange, options, id, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  id?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const scored: Array<{ option: string; score: number }> = [];
    for (const option of options) {
      const score = rank(option, value);
      if (score !== null) scored.push({ option, score });
    }
    scored.sort((a, b) => a.score - b.score || a.option.localeCompare(b.option));
    return scored.slice(0, MAX_RESULTS).map(s => s.option);
  }, [options, value]);

  // Click outside closes the list; the typed value is kept either way.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Reset the highlight when the query (value) changes, so it never points past
  // a shrunken result list — matches TimezonePicker's behaviour.
  useEffect(() => { setActive(0); }, [value]);

  function choose(option: string) {
    onChange(option);
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
      // Only steal Enter when a suggestion is highlighted; otherwise let the
      // form handle it so typing a brand-new key and hitting Enter submits.
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
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => { setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />

      {open && results.length > 0 && (
        <div className="tzp-list" role="listbox" ref={listRef}>
          {results.map((option, i) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              data-active={i === active}
              className={`tzp-opt${i === active ? ' active' : ''}`}
              // mousedown, not click: the input's blur would otherwise close the
              // list before the click landed.
              onMouseDown={e => { e.preventDefault(); choose(option); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="tzp-zone">{option}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
