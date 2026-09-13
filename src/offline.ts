export async function prepareOffline() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.register("/sw.js");
  if (registration.active) return true;
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
  return true;
}
