// The backend serves this frontend, so '/api' is same-origin in production.
// In dev, Vite proxies '/api' to the local server. VITE_API_URL is an optional
// override for pointing at a backend on a different origin.
const BASE = import.meta.env.VITE_API_URL || '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

// A 401 on anything other than a login/register attempt means the stored token
// is no longer valid (expired, or its user was deleted). Drop it and bounce to
// the auth screen so the app can't keep running in a half-logged-in state.
function handleAuthFailure(path: string, status: number) {
  if (status !== 401) return;
  if (/^\/auth\/(login|register)$/.test(path)) return;
  localStorage.removeItem('token');
  if (!window.location.pathname.startsWith('/auth')) window.location.assign('/auth');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  // Precedence matches the original: default Content-Type, then the token,
  // then any caller-supplied headers (which may override either).
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, options.headers as Record<string, string> | undefined);

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  // An empty/non-JSON body (e.g. 204 responses) is treated as an empty object.
  const data: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    handleAuthFailure(path, res.status);
    const message =
      typeof data === 'object' && data !== null &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

async function requestForm<T>(path: string, body: FormData, method: string): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, body, headers });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleAuthFailure(path, res.status);
    const message =
      typeof data === 'object' && data !== null &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

// Upload URLs (/uploads/...) are served through an auth-gated route. <img> tags
// can't set an Authorization header, so append the token as a query param. Pass
// through absolute/external URLs and empty values untouched.
export function uploadUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const token = getToken();
  if (!token || !url.startsWith('/uploads/')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  patchForm: <T>(path: string, body: FormData) => requestForm<T>(path, body, 'PATCH'),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
