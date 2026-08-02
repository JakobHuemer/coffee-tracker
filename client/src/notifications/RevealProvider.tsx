import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNotifications, useMarkNotificationsRead } from '../hooks/useNotifications';
import { MatchReveal } from './MatchReveal';
import type { AppNotification } from '../types';

// Owns the fullscreen match-reveal queue and surface. A match_end is generic
// until revealed; the reveal (or a swipe) marks it read — reveal state IS read
// state (docs/notifications-reveals.md). Two ways a reveal starts:
//   - in-app: tapping the generic toast/card calls playOne();
//   - on return / fresh open: pending unread reveals auto-play (boot + Page
//     Visibility hidden→visible), queued, draining before any toast.
// `revealing` lets the toaster hold toasts while a reveal is on screen.

interface RevealCtx { playOne: (n: AppNotification) => void; revealing: boolean }
const Ctx = createContext<RevealCtx>({ playOne: () => {}, revealing: false });
export const useReveals = () => useContext(Ctx);

const isMatch = (n: AppNotification) => n.type === 'match_end';

export function RevealProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const { data } = useNotifications(active);
  const markRead = useMarkNotificationsRead();
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const [index, setIndex] = useState(0);
  const handled = useRef<Set<string>>(new Set()); // ids already queued (no auto-replay)
  const booted = useRef(false);
  const wasHidden = useRef(false);
  const cache = useRef<AppNotification[] | undefined>(undefined);
  cache.current = data?.notifications;

  // Auto-play: pending unread match reveals we haven't queued yet, oldest first.
  const autoPlay = useCallback((list: AppNotification[]) => {
    const fresh = list.filter((n) => isMatch(n) && n.read_at === null && !handled.current.has(n.id));
    if (!fresh.length) return;
    fresh.sort((a, b) => a.created_at - b.created_at);
    fresh.forEach((n) => handled.current.add(n.id));
    setQueue((q) => { if (q.length === 0) setIndex(0); return [...q, ...fresh]; });
  }, []);

  // Tap-to-open (in-app): play this one now, even if it was seen before.
  const playOne = useCallback((n: AppNotification) => {
    if (!isMatch(n)) return;
    handled.current.add(n.id);
    setQueue((q) => { if (q.length === 0) setIndex(0); return [...q, n]; });
  }, []);

  // Fresh open (SPA boot): first time we have data, drain pending reveals.
  useEffect(() => {
    if (active && !booted.current && cache.current) { booted.current = true; autoPlay(cache.current); }
  }, [active, data, autoPlay]);

  // Return from background: hidden→visible counts as "came back to the app".
  useEffect(() => {
    if (!active) return;
    const onVis = () => {
      if (document.hidden) { wasHidden.current = true; return; }
      if (wasHidden.current) { wasHidden.current = false; if (cache.current) autoPlay(cache.current); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active, autoPlay]);

  // Reveal shown to completion → mark read (reveal state = read state), advance.
  const advance = useCallback(() => {
    const cur = queue[index];
    if (cur) markRead.mutate({ ids: [cur.id] });
    if (index >= queue.length - 1) { setQueue([]); setIndex(0); }
    else setIndex(index + 1);
  }, [queue, index, markRead]);

  const current = active ? queue[index] : undefined;

  return (
    <Ctx.Provider value={{ playOne, revealing: !!current }}>
      {children}
      {current && (
        <MatchReveal key={current.id} n={current} index={index} total={queue.length} onAdvance={advance} />
      )}
    </Ctx.Provider>
  );
}
