export type Fetch = typeof fetch;

export class PublishError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

export async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const b = body as { error?: { message?: string }; message?: string };
    throw new PublishError(`${what} failed (${res.status}): ${b?.error?.message ?? b?.message ?? text.slice(0, 200)}`, res.status, res.status === 429 || res.status >= 500);
  }
  return body as T;
}
