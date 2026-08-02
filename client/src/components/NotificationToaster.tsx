import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useNotifications } from '../hooks/useNotifications';
import { toastFor } from '../notifications/catalog';

// Transient toasts for newly-arrived notifications. Global, mounted once. Only
// types the catalog opts in via toastFor() pop (match results are excluded by
// design). One entrance animation for all — no per-type variety.
const TOAST_MS = 4500;

interface ToastItem { key: string; icon: string; title: string; body: string }

export function NotificationToaster() {
  const { data } = useNotifications();
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const list = data?.notifications;
    if (!list) return;

    // First fetch seeds the "already seen" set so existing history never toasts;
    // only notifications that appear on a later poll are new.
    if (!seeded.current) {
      for (const n of list) seen.current.add(n.id);
      seeded.current = true;
      return;
    }

    const fresh: ToastItem[] = [];
    for (const n of list) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.read_at !== null) continue; // already read elsewhere → don't toast
      const t = toastFor(n);            // catalog decides eligibility
      if (t) fresh.push({ key: n.id, ...t });
    }
    if (fresh.length) setToasts((prev) => [...prev, ...fresh]);
  }, [data]);

  if (toasts.length === 0) return null;

  return (
    <div className="ntf-toast-wrap">
      {toasts.map((t) => (
        <Toast key={t.key} t={t} onDone={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))} />
      ))}
    </div>
  );
}

function Toast({ t, onDone }: { t: ToastItem; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => done.current(), TOAST_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="ntf-toast" role="status" onClick={() => done.current()}>
      <span className="ntf-toast-icon"><Icon name={t.icon} size={20} /></span>
      <div className="ntf-toast-body">
        <div className="ntf-toast-title">{t.title}</div>
        <div className="ntf-toast-text">{t.body}</div>
      </div>
    </div>
  );
}
