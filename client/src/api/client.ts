// The backend serves this frontend, so '/api' is same-origin in production.
// In dev, Vite proxies '/api' to the local server. VITE_API_URL is an optional
// override for pointing at a backend on a different origin.
const BASE = import.meta.env.VITE_API_URL || '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
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
    const message =
      typeof data === 'object' && data !== null &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
