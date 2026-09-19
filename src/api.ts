export class ApiError extends Error {
  activityId?: string;
  remaining?: number;
  constructor(
    message: string,
    body: { activity_id?: string; remaining?: number },
  ) {
    super(message);
    this.activityId = body.activity_id;
    this.remaining = body.remaining;
  }
}

export async function api<T>(
  path: string,
  body?: unknown | FormData,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers:
      body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(135000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof value.detail === "string"
        ? value.detail
        : response.status === 422
          ? "Please check your note and try again."
          : "The server could not complete your request.";
    throw new ApiError(message, value);
  }
  return value;
}
