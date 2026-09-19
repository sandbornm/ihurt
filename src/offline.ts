import { isNativeApp } from "./platform/files";

export async function prepareOffline() {
  // The native app bundles the complete notebook, anatomy, and hand model.
  if (isNativeApp()) return true;
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return false;
  if (document.readyState !== "complete")
    await new Promise<void>((resolve) =>
      window.addEventListener("load", () => resolve(), { once: true }),
    );
  const registration = await navigator.serviceWorker.register("/sw.js");
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Offline copy not ready")),
        60000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const worker =
    registration.active ?? (await navigator.serviceWorker.ready).active;
  if (!worker) return true;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Offline copy not ready")),
      60000,
    );
    const done = () => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data === "cached") done();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage("ensure-cache");
  });
  return true;
}
