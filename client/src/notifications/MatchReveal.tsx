import { useEffect, useRef, useState } from 'react';
import { renderNotification, ordinal } from './catalog';
import type { AppNotification } from '../types';

// One fullscreen match reveal — a scoreboard that assembles, staggered:
// result → placing → rating change (the hero) → standing rating (quiet). Tone
// splits win/loss/tie with EQUAL weight (win rises light, loss falls heavy).
// First tap skips the build-up; a second tap advances (handled by the caller).
// Spec: docs/notifications-reveals.md.

const CLS: Record<string, 'win' | 'loss' | 'tie'> = { up: 'win', down: 'loss', neutral: 'tie' };
const WORD: Record<string, string> = { Won: 'WON', Lost: 'DEFEAT', Tied: 'TIE' };
const COUNT_MS = 1250;

function prefersReduced(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const fmtDelta = (v: number) => { const n = Math.round(v); return n > 0 ? '+' + n : n < 0 ? String(n) : '±0'; };
const fmtInt = (v: number) => String(Math.round(v));

export function MatchReveal(
  { n, index, total, onAdvance }:
  { n: AppNotification; index: number; total: number; onAdvance: () => void },
) {
  const r = renderNotification(n);
  const [hint, setHint] = useState('tap to skip');
  const phase = useRef<'building' | 'assembled'>('building');
  const stageRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const rafs = useRef<number[]>([]);
  const finishRef = useRef<() => void>(() => {});

  // Non-match payloads should never reach here; if one does, skip it cleanly.
  const isMatch = r.kind === 'match';
  const last = index === total - 1;

  useEffect(() => {
    if (!isMatch) { onAdvance(); return; }
    const cls = CLS[r.tone];
    const stage = stageRef.current!;
    const q = (sel: string) => stage.querySelector<HTMLElement>(sel)!;
    const rows = Array.from(stage.querySelectorAll<HTMLElement>('.nr-row'));
    const deltaEl = q('.nr-delta'), finalEl = q('.nr-final b'), resultEl = q('.nr-result'),
          shockEl = q('.nr-shock'), sweepEl = q('.nr-sweep');
    const reduced = prefersReduced();

    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; rafs.current.forEach(cancelAnimationFrame); rafs.current = []; };
    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

    const countTo = (el: HTMLElement, from: number, to: number, fmt: (v: number) => string) => {
      if (reduced || from === to) { el.textContent = fmt(to); return; }
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / COUNT_MS), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(from + (to - from) * e);
        if (p < 1) rafs.current.push(requestAnimationFrame(step));
      };
      rafs.current.push(requestAnimationFrame(step));
    };

    const burst = () => {
      if (reduced || cls === 'tie') return;
      for (let i = 0; i < 12; i++) {
        const s = document.createElement('span');
        const a = Math.random() * Math.PI * 2, d = 44 + Math.random() * 52, dx = Math.cos(a) * d;
        if (cls === 'win') {
          s.className = 'nr-spark';
          s.style.setProperty('--dx', dx + 'px');
          s.style.setProperty('--dy', (Math.sin(a) * d - 28) + 'px');       // rise
          s.style.background = i % 3 ? 'var(--success-fg)' : '#ffffff';
        } else {
          s.className = 'nr-shard';
          s.style.setProperty('--dx', dx + 'px');
          s.style.setProperty('--dy', (Math.abs(Math.sin(a) * d) + 34) + 'px'); // fall
          s.style.background = i % 4 ? 'var(--danger-fg)' : '#6b2f2a';
        }
        resultEl.appendChild(s);
        window.setTimeout(() => s.remove(), 1000);
      }
    };

    const impact = () => {
      if (reduced || cls === 'tie') return;
      shockEl.classList.remove('run'); void shockEl.offsetWidth; shockEl.classList.add('run');
      stage.classList.remove('shake-win', 'shake-loss'); void stage.offsetWidth;
      stage.classList.add(cls === 'win' ? 'shake-win' : 'shake-loss');
      burst();
      at(560, () => stage.classList.remove('shake-win', 'shake-loss'));
    };

    const settle = () => {
      phase.current = 'assembled';
      setHint(last ? 'tap to close' : 'tap to continue');
    };

    finishRef.current = () => { // skip build-up → fully assembled
      clear();
      rows.forEach((row) => row.classList.add('in'));
      deltaEl.textContent = fmtDelta(r.delta);
      finalEl.textContent = fmtInt(r.ratingAfter);
      settle();
    };

    if (reduced) { finishRef.current(); return clear; }

    at(120, () => rows[0].classList.add('in'));
    at(440, () => {
      rows[1].classList.add('in');
      if (cls === 'win') sweepEl.classList.add('run');
      at(150, impact);
    });
    at(1060, () => rows[2].classList.add('in'));
    at(1580, () => { rows[3].classList.add('in'); countTo(deltaEl, 0, r.delta, fmtDelta); });
    at(2180, () => {
      rows[4].classList.add('in');
      countTo(finalEl, r.ratingBefore, r.ratingAfter, fmtInt);
      at(COUNT_MS, settle);
    });
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id]);

  const onTap = () => {
    if (phase.current === 'building') finishRef.current();
    else onAdvance();
  };

  if (!isMatch) return null;
  const cls = CLS[r.tone];
  const eyebrow = r.context + (r.mode ? ' · ' + r.mode : '');

  return (
    <div className={`nr ${cls}`} role="dialog" aria-modal="true"
         aria-label={`${r.result} your ${r.mode} match, ${ordinal(r.rank)} of ${r.count}, rating ${fmtDelta(r.delta)}`}
         onClick={onTap}>
      <div className="nr-tone" />
      {total > 1 && (
        <div className="nr-progress" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => <i key={i} className={i <= index ? 'active' : ''} />)}
        </div>
      )}
      <div className="nr-stage" ref={stageRef}>
        <div className="nr-row nr-eyebrow">{eyebrow}</div>
        <div className="nr-row nr-result"><span className="nr-shock" /><span>{WORD[r.result]}</span><span className="nr-sweep" /></div>
        <div className="nr-row nr-place">{ordinal(r.rank)} <small>of {r.count}</small></div>
        <div className="nr-row nr-delta-row"><div className="nr-delta">{fmtDelta(0)}</div></div>
        <div className="nr-row nr-final"><b>{fmtInt(r.ratingBefore)}</b></div>
      </div>
      <div className="nr-hint">{hint}</div>
    </div>
  );
}
