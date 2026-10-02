import { isNativeApp } from "./platform/files.ts";

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
  if (isNativeApp())
    throw new ApiError(
      "The local AI server is available in the web app. On iOS, use on-device dictation or Share with AI.",
      {},
    );
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
  const value: unknown = await response.json().catch(() => null);
  const object =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  if (!response.ok) {
    const message =
      typeof object?.detail === "string"
        ? object.detail
        : response.status === 422
          ? "Please check your note and try again."
          : "The server could not complete your request.";
    throw new ApiError(message, {
      activity_id:
        typeof object?.activity_id === "string"
          ? object.activity_id
          : undefined,
      remaining:
        typeof object?.remaining === "number" ? object.remaining : undefined,
    });
  }
  if (!object)
    throw new ApiError(
      "The local AI server returned an unreadable response. Check that it is running and try again.",
      {},
    );
  return object as T;
}
