/* Coffee Tracker service worker — Web Push only (issue #87).
 *
 * Deliberately NOT a caching/offline worker: it registers no fetch handler, so
 * it never intercepts requests and can never serve a stale SPA build. Its only
 * jobs are receiving push events while the app is closed and routing a tap on
 * the resulting notification back into the app.
 *
 * The server ships only the frozen { id, type, payload } of a notification; the
 * human sentence is built HERE, mirroring src/notifications/catalog.tsx, so the
 * wording lives in the frontend for both the in-app card and the OS push. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// { type, payload } → { title, body }. Keep in step with the in-app catalog.
function present(type, payload) {
  const p = payload || {};
  if (type === 'achievement' || type === 'badge') {
    const tag = type === 'achievement' ? 'Achievement' : 'Badge';
    return { title: p.name || tag, body: p.description || `${tag} unlocked` };
  }
  if (type === 'match_end') {
    const delta = p.delta || 0;
    const result = delta > 0 ? 'Won' : delta < 0 ? 'Lost' : 'Tied';
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    const context = p.group_name || 'Global';
    const place = p.rank != null && p.participant_count != null
      ? `${ordinal(p.rank)} of ${p.participant_count}, ` : '';
    return {
      title: 'Match result',
      body: `${result} your ${p.mode || ''} match — ${place}${sign}${Math.abs(delta)} · ${context}`.replace(/\s+/g, ' ').trim(),
    };
  }
  // Unknown type shipped ahead of this worker — still surface something.
  return { title: 'Coffee Tracker', body: 'You have a new notification.' };
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const { title, body } = present(data.type, data.payload);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      // Collapse repeats of the same event, and carry where a tap should land.
      tag: data.id || undefined,
      data: { url: '/notifications' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an already-open tab (and route it) instead of opening another.
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) { try { client.navigate(url); } catch { /* cross-origin */ } }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
