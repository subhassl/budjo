export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, message: string, opts: { code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = opts.code ?? 'error';
    this.details = opts.details;
  }
}

export const badRequest = (m: string, details?: unknown) =>
  new HttpError(400, m, { code: 'bad_request', details });
export const unauthorized = (m = 'Sign in required') => new HttpError(401, m, { code: 'unauthorized' });
export const forbidden = (m = 'Not allowed') => new HttpError(403, m, { code: 'forbidden' });
export const notFound = (m = 'Not found') => new HttpError(404, m, { code: 'not_found' });
export const conflict = (m: string) => new HttpError(409, m, { code: 'conflict' });
