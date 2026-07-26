import { QueryClient } from '@tanstack/react-query';

// The single query cache for the app. It lives here rather than in main.tsx so
// non-React code can reach it — specifically the auth store, which has to drop
// every cached response on logout. Cached data is per-account: leaving it in
// place means the next person to sign in on this device sees the previous
// account's feed, stats and Buzz until each query happens to refetch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});
