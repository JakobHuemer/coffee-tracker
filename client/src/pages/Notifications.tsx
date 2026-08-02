import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { useNotifications, useMarkNotificationsRead } from '../hooks/useNotifications';
import { renderNotification, ordinal, type RenderedNotification } from '../notifications/catalog';
import type { AppNotification } from '../types';

function when(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Type-aware card body. Every kind uses the same building blocks (badge, title,
// time, pills, description) so the types read as one system.
function CardBody({ r, time }: { r: RenderedNotification; time: string }) {
  if (r.kind === 'match') {
    const sign = r.delta > 0 ? '+' : r.delta < 0 ? '−' : '';
    return (
      <>
        <span className="ntf-badge" data-tone={r.tone}><Icon name={r.icon} size={20} /></span>
        <div className="ntf-main">
          <div className="ntf-head">
            <span className="ntf-title"><span data-tone={r.tone}>{r.result}</span> your {r.mode} match</span>
            <span className="ntf-time">{time}</span>
          </div>
          <div className="ntf-meta">
            <span className="ntf-pill">{ordinal(r.rank)} of {r.count}</span>
            <span className="ntf-pill" data-tone={r.tone}>{sign}{Math.abs(r.delta)}</span>
            <span className="ntf-context">{r.context}</span>
          </div>
        </div>
      </>
    );
  }
  if (r.kind === 'simple') {
    return (
      <>
        <span className="ntf-badge" data-tone="neutral"><Icon name={r.icon} size={20} /></span>
        <div className="ntf-main">
          <div className="ntf-head">
            <span className="ntf-title">{r.name}</span>
            <span className="ntf-pill" data-variant="tag">{r.tag}</span>
            <span className="ntf-time">{time}</span>
          </div>
          <div className="ntf-desc">{r.description}</div>
        </div>
      </>
    );
  }
  return (
    <>
      <span className="ntf-badge" data-tone="neutral"><Icon name={r.icon} size={20} /></span>
      <div className="ntf-main">
        <div className="ntf-head">
          <span className="ntf-title">{r.title}</span>
          <span className="ntf-time">{time}</span>
        </div>
        <div className="ntf-desc">{r.rows.map(([k, v]) => `${k}: ${v}`).join('\n')}</div>
      </div>
    </>
  );
}

// One notification. Swipe is native CSS scroll-snap: unread items render an
// action pane on each side of the card; the card starts centred, and snapping
// it onto either pane marks it read. Read items render just the card.
function NotificationRow({ n, onRead }: { n: AppNotification; onRead: (id: string) => void }) {
  const r = renderNotification(n);
  const unread = n.read_at === null;
  const trackRef = useRef<HTMLLIElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const armed = useRef(false);

  // Centre on the card before paint. Disarm the scroll handler until the
  // programmatic scroll settles so centring never counts as a swipe.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const card = cardRef.current;
    if (!track || !card || !unread) return;
    armed.current = false;
    track.scrollLeft = card.offsetLeft;
    const id = requestAnimationFrame(() => { armed.current = true; });
    return () => cancelAnimationFrame(id);
  }, [unread]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !unread) return;
    const onScrollEnd = () => {
      const card = cardRef.current;
      if (!card || !armed.current) return;
      // Card no longer centred → it was swiped onto an action pane.
      if (Math.abs(track.scrollLeft - card.offsetLeft) > card.clientWidth / 2) onRead(n.id);
    };
    track.addEventListener('scrollend', onScrollEnd);
    return () => track.removeEventListener('scrollend', onScrollEnd);
  }, [n.id, unread, onRead]);

  const time = when(n.created_at);
  return (
    <li className="ntf" data-unread={unread} ref={trackRef}>
      {unread && (
        <button className="ntf-action" onClick={() => onRead(n.id)} aria-label="Mark read">
          <Icon name="check" size={16} /> Read
        </button>
      )}
      <div className="ntf-card" ref={cardRef}><CardBody r={r} time={time} /></div>
      {unread && (
        <button className="ntf-action" onClick={() => onRead(n.id)} aria-label="Mark read">
          <Icon name="check" size={16} /> Read
        </button>
      )}
    </li>
  );
}

export function Notifications() {
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const list = data?.notifications ?? [];
  const unread = data?.unread_count ?? 0;

  return (
    <div className="page">
      <AppHeader />
      <div className="page-header">
        <div className="notif-head-row">
          <h2>Notifications</h2>
          <button className="notif-markall" disabled={unread === 0} onClick={() => markRead.mutate({ all: true })}>
            <Icon name="check" size={14} /> Mark all read
          </button>
        </div>
      </div>

      <ul className="notif-list">
        {isLoading && <div className="notif-empty">Loading…</div>}
        {!isLoading && list.length === 0 && <div className="notif-empty">No notifications yet.</div>}
        {list.map((n) => (
          <NotificationRow key={n.id} n={n} onRead={(id) => markRead.mutate({ ids: [id] })} />
        ))}
      </ul>
    </div>
  );
}
