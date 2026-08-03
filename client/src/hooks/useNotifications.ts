import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AppNotification, NotificationsResponse } from '../types';

// Polling is a stopgap (issue #32 §7): when #54 (live data over websockets/SSE)
// lands, this 60s interval should be replaced by a push over that connection so
// the bell updates on server event instead of on a timer. This hook is the
// single revisit point for that swap.
const POLL_MS = 60_000;

export function useNotifications(enabled = true) {
  return useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

type MarkArg = { ids: string[] } | { all: true };

// Mark rows read — a list of ids, or all.
//
// The update is applied OPTIMISTICALLY so the swiped row flips to read (and
// sheds its swipe panes / scroll-snap track) the instant the gesture crosses
// the threshold. That is load-bearing, not just snappy UX: a row that is still
// a live scroll-snap track while its snap animation settles captures the next
// touch, which is what blocked marking cards read in fast succession
// bottom-to-top. Collapsing the row immediately removes that animation window.
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg: MarkArg) =>
      api.post<{ ok: boolean; unread_count: number }>('/notifications/read', arg),
    onMutate: async (arg: MarkArg) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const prev = qc.getQueryData<NotificationsResponse>(['notifications']);
      if (prev) {
        const now = Date.now();
        const hit = (n: AppNotification) =>
          n.read_at === null && ('all' in arg || arg.ids.includes(n.id));
        const next: NotificationsResponse = {
          notifications: prev.notifications.map((n) =>
            hit(n) ? { ...n, read_at: now } : n),
          unread_count: Math.max(0, prev.unread_count -
            prev.notifications.filter(hit).length),
        };
        qc.setQueryData(['notifications'], next);
      }
      return { prev };
    },
    onError: (_e, _arg, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
