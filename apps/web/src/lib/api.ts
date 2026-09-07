export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body.error === 'string' ? body.error : 'Something went wrong',
      typeof body.code === 'string' ? body.code : 'error',
      body.details,
    );
  }
  return body as T;
}

export const post = <T>(path: string, body?: unknown, idempotencyKey?: string) =>
  api<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Fresh key per user action, so a retry of *that* action is de-duplicated. */
export const idemKey = () => crypto.randomUUID();
