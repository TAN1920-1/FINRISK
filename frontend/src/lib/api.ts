/**
 * Centralised HTTP client.
 *
 * Every screen goes through this module, so three cross-cutting concerns are
 * implemented exactly once:
 *
 * 1. **One base URL.** `VITE_API_BASE_URL` decides where the API lives. Nothing
 *    else in the app contains a hostname, so a deployment is a build-time
 *    setting rather than a code edit. When the variable is empty the client
 *    calls the same origin, which is what the Vite dev proxy and a
 *    reverse-proxied deployment both provide.
 * 2. **One tenant header.** The active organization travels as
 *    `X-Organization-Id` on every request. The backend re-checks membership,
 *    so this header can only ever *narrow* what the caller sees.
 * 3. **One error shape.** FastAPI returns either a string `detail` or a list of
 *    validation errors. Both are normalised into `ApiError`, which carries a
 *    message safe to show a user plus per-field messages for form binding.
 *    Failures are never swallowed: `ApiError` propagates to the caller.
 */

import type { ApiErrorBody } from '@/types/api';

const RAW_BASE = (import.meta.env.BASE_URL ?? '').trim();

/** Base URL without a trailing slash. Empty string means "same origin". */
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '');

const SESSION_STORAGE_KEY = 'finrisk.session.v2';

export interface StoredSession {
  token: string;
  organizationId: number | null;
  expiresAt: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly fieldErrors?: Record<string, string>;
  readonly payload?: unknown;

  constructor(
    status: number,
    detail: string,
    options: { fieldErrors?: Record<string, string>; payload?: unknown } = {},
  ) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.fieldErrors = options.fieldErrors;
    this.payload = options.payload;
  }

  /** True when the caller simply is not allowed to do this. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

let token: string | null = null;
let organizationId: number | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function loadStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || !parsed.token) return null;
    return {
      token: parsed.token,
      organizationId:
        typeof parsed.organizationId === 'number' ? parsed.organizationId : null,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    };
  } catch {
    return null;
  }
}

export function setSession(next: StoredSession | null): void {
  token = next?.token ?? null;
  organizationId = next?.organizationId ?? null;
  try {
    if (next) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Private browsing or a full quota: the in-memory token still works for the
    // current tab, so this is not worth failing a sign-in over.
  }
}

export function setActiveOrganization(id: number | null): void {
  organizationId = id;
  const current = loadStoredSession();
  if (current) {
    setSession({ ...current, organizationId: id });
  }
}

export function getAccessToken(): string | null {
  return token;
}

/** Called when the API answers 401 so the app can return to the sign-in screen. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | null | undefined;

export function buildUrl(path: string, query?: Record<string, QueryValue | QueryValue[]>): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const list = value.filter((item) => item !== undefined && item !== null && item !== '');
      if (list.length) params.set(key, list.join(','));
      continue;
    }
    params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `${url}?${serialised}` : url;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, QueryValue | QueryValue[]>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Mutually exclusive with `body` (file uploads). */
  formData?: FormData;
}

function fieldErrorsFrom(detail: ApiErrorBody['detail']): Record<string, string> | undefined {
  if (!Array.isArray(detail)) return undefined;
  const result: Record<string, string> = {};
  for (const item of detail) {
    const field = item.loc.filter((part) => part !== 'body' && part !== 'query').join('.');
    if (field && !result[field]) result[field] = item.msg;
  }
  return Object.keys(result).length ? result : undefined;
}

function messageFrom(status: number, body: unknown): string {
  const parsed = (body ?? {}) as ApiErrorBody;

  if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
    return parsed.detail;
  }
  if (Array.isArray(parsed.detail) && parsed.detail.length) {
    const first = parsed.detail[0];
    const field = first.loc.filter((part) => part !== 'body' && part !== 'query').join('.');
    return field ? `${field}: ${first.msg}` : first.msg;
  }
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'That record could not be found.';
  if (status >= 500) return 'The server could not complete the request. Please try again.';
  return `Request failed with status ${status}.`;
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text ? { detail: text } : null;
  } catch {
    return null;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, headers, signal, formData } = options;

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (organizationId !== null) {
    requestHeaders['X-Organization-Id'] = String(organizationId);
  }

  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: requestHeaders,
      body: payload,
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'Could not reach the API. Check that the backend is running and that BASE_URL points at it.',
      { payload: error },
    );
  }

  if (response.status === 401) {
    // A rejected token is not recoverable client-side: drop it and let the app
    // route back to sign-in rather than leaving the user on a broken screen.
    setSession(null);
    unauthorizedHandler?.();
  }

  if (!response.ok) {
    const errorBody = await readBody(response);
    throw new ApiError(response.status, messageFrom(response.status, errorBody), {
      fieldErrors: fieldErrorsFrom((errorBody as ApiErrorBody)?.detail),
      payload: errorBody,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

export function triggerDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * POST a body and save the returned file, honouring `Content-Disposition`.
 * Used by the report export and the CSV exports.
 */
export async function postForFile(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<string> {
  const requestHeaders: Record<string, string> = {
    Accept: '*/*',
    'Content-Type': 'application/json',
  };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (organizationId !== null) requestHeaders['X-Organization-Id'] = String(organizationId);

  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    const errorBody = await readBody(response);
    if (response.status === 401) {
      setSession(null);
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, messageFrom(response.status, errorBody), {
      payload: errorBody,
    });
  }

  const filename = filenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackName;
  triggerDownload(await response.blob(), filename);
  return filename;
}

/** GET a file (CSV exports) and save it. */
export async function getForFile(path: string, query: Record<string, QueryValue> = {}, fallbackName: string): Promise<string> {
  const requestHeaders: Record<string, string> = { Accept: '*/*' };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (organizationId !== null) requestHeaders['X-Organization-Id'] = String(organizationId);

  const response = await fetch(buildUrl(path, query), { headers: requestHeaders });
  if (!response.ok) {
    const errorBody = await readBody(response);
    if (response.status === 401) {
      setSession(null);
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, messageFrom(response.status, errorBody), {
      payload: errorBody,
    });
  }
  const filename = filenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackName;
  triggerDownload(await response.blob(), filename);
  return filename;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}
