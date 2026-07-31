import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import './index.css';
import App from './App';
import { queryClient } from './queryClient';

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
