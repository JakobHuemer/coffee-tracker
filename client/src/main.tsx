import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import './index.css';
import App from './App';
import { queryClient } from './queryClient';

// Register the Web Push service worker (issue #87). It only handles push +
// notification clicks (no fetch/caching), so registering it up front just makes
// push available once the user opts in — it never intercepts app requests.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* push simply stays unavailable */ });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user" makes every Motion animation honour the OS
        "reduce motion" setting app-wide — no per-component guard needed. */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>
);
