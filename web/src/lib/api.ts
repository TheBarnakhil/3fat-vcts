/**
 * Browser-side fetch helper that forwards cookies and surfaces typed errors.
 * Route handlers read `vcts_access` from the httpOnly cookie for us.
 */

export type ApiError = {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
};

export async function api<T = unknown>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(input, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    // Server wraps errors as { error: { code, message, details } }.
    const wrapped =
      body && typeof body === "object" && "error" in body
        ? ((body as { error?: { code?: string; message?: string } }).error ??
          undefined)
        : undefined;

    const err: ApiError = {
      status: res.status,
      message: wrapped?.message || res.statusText || "Request failed",
      code: wrapped?.code,
      details: body,
    };
    throw err;
  }

  return body as T;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    !!value &&
    typeof value === "object" &&
    "status" in value &&
    "message" in value
  );
}
