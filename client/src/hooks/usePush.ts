import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { VapidKeyResponse } from '../types';

// Web Push opt-in for the current device (issue #87). Owns the browser-side
// subscription lifecycle: it reads whether the deployment has push configured,
// reflects this device's current permission + subscription state, and exposes
// subscribe/unsubscribe. The server only ever stores the resulting endpoint —
// the OS-level notification is delivered by the service worker (public/sw.js).
//
// Android Chrome/Edge support this from an ordinary browser tab. iOS needs the
// PWA installed to the Home Screen first (out of scope, issue #87), so on iOS
// Safari `supported` is simply false and the toggle stays hidden.

// VAPID keys travel as URL-safe base64; PushManager.subscribe wants the raw
// bytes as a Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  // Back the array with a concrete ArrayBuffer so its type is
  // Uint8Array<ArrayBuffer> — what PushManager.subscribe's BufferSource wants.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = {
  supported: boolean;      // this browser can do Web Push at all
  configured: boolean;     // the deployment has VAPID keys
  permission: NotificationPermission; // 'default' | 'granted' | 'denied'
  subscribed: boolean;     // this device is currently subscribed
  busy: boolean;
  error: string | null;
};

const SUPPORTED =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function usePush() {
  const [state, setState] = useState<PushState>({
    supported: SUPPORTED,
    configured: false,
    permission: SUPPORTED ? Notification.permission : 'denied',
    subscribed: false,
    busy: SUPPORTED,
    error: null,
  });
  const [key, setKey] = useState<string | null>(null);

  // On mount: learn whether the server offers push and whether this device is
  // already subscribed. Both are read-only; nothing prompts the user here.
  useEffect(() => {
    if (!SUPPORTED) return;
    let cancelled = false;

    (async () => {
      try {
        const cfg = await api.get<VapidKeyResponse>('/push/vapid-public-key');
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setKey(cfg.key);
        setState((s) => ({
          ...s,
          configured: cfg.enabled,
          subscribed: !!existing,
          permission: Notification.permission,
          busy: false,
        }));
      } catch {
        if (!cancelled) setState((s) => ({ ...s, busy: false }));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const subscribe = useCallback(async () => {
    if (!SUPPORTED || !key) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState((s) => ({ ...s, permission, busy: false }));
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await api.post('/push/subscribe', sub.toJSON());
      setState((s) => ({ ...s, subscribed: true, permission, busy: false }));
    } catch (err) {
      setState((s) => ({
        ...s, busy: false,
        error: err instanceof Error ? err.message : 'Could not enable notifications',
      }));
    }
  }, [key]);

  const unsubscribe = useCallback(async () => {
    if (!SUPPORTED) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setState((s) => ({ ...s, subscribed: false, busy: false }));
    } catch (err) {
      setState((s) => ({
        ...s, busy: false,
        error: err instanceof Error ? err.message : 'Could not disable notifications',
      }));
    }
  }, []);

  return { ...state, subscribe, unsubscribe };
}
