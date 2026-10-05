'use client';

/** Shared fetch helper for client components: JSON in, typed result or an error string. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function apiCall<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error ?? `Request failed (${res.status}).`,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection.' };
  }
}

export const post = <T,>(path: string, body?: unknown) => apiCall<T>(path, { method: 'POST', body });
export const patch = <T,>(path: string, body?: unknown) => apiCall<T>(path, { method: 'PATCH', body });
export const del = <T,>(path: string) => apiCall<T>(path, { method: 'DELETE' });
