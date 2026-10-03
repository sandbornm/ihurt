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
  // Keep the deadline even when the caller also needs to cancel. Use a
  // controller instead of AbortSignal.any for older supported WebKit versions.
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          "The request timed out. Please try again.",
          "TimeoutError",
        ),
      ),
    135000,
  );
  try {
    const response = await fetch(`/api/${path}`, {
      method: body !== undefined ? "POST" : "GET",
      credentials: "same-origin",
      headers:
        body !== undefined && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        body instanceof FormData
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
      signal: controller.signal,
    });
    const value: unknown = await response.json().catch(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return null;
    });
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
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
