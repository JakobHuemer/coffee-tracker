import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { NotificationsResponse } from '../types';

// Polling is a stopgap (issue #32 §7): when #54 (live data over websockets/SSE)
// lands, this 60s interval should be replaced by a push over that connection so
// the bell updates on server event instead of on a timer. This hook is the
// single revisit point for that swap.
const POLL_MS = 60_000;

export function useNotifications() {
  return useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

// Mark rows read — a list of ids, or all. Invalidates the feed so the bell
// badge and the page reflect the new unread count immediately.
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg: { ids: string[] } | { all: true }) =>
      api.post<{ ok: boolean; unread_count: number }>('/notifications/read', arg),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
