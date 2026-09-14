import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
export function serviceWorkerSource(cache, paths) {
  return `const CACHE=${JSON.stringify(cache)};
const PATHS=${JSON.stringify(paths)};
const ALLOWED=new Set(PATHS);
async function fill(cache, files) {
  if (!files.length) return;
  await cache.addAll(files.map((path)=>new Request(path,{credentials:"omit"})));
}
async function populate() {
  const cache=await caches.open(CACHE);
  const missing=[];
  for (const path of PATHS) if (!(await cache.match(path))) missing.push(path);
  const late=(path)=>path.endsWith(".glb")||path.startsWith("/mediapipe/");
  await fill(cache, missing.filter((path)=>!late(path)));
  await fill(cache, missing.filter((path)=>path.endsWith(".glb")));
  return cache;
}
self.addEventListener("install", (event)=>event.waitUntil(populate().then(()=>self.skipWaiting())));
self.addEventListener("activate", (event)=>event.waitUntil((async()=>{
  for (const key of await caches.keys()) if (key.startsWith("ihurt-static-") && key!==CACHE) await caches.delete(key);
  await self.clients.claim();
  for (const client of await self.clients.matchAll()) client.postMessage("cached");
})()));
self.addEventListener("message", (event)=>{
  if (event.data!=="ensure-cache") return;
  event.waitUntil((async()=>{
    await populate();
    if (event.source) event.source.postMessage("cached");
    else for (const client of await self.clients.matchAll()) client.postMessage("cached");
  })());
});
self.addEventListener("fetch", (event)=>{
  const url=new URL(event.request.url);
  if (event.request.method!=="GET" || url.origin!==self.location.origin || url.pathname.startsWith("/api/")) return;
  let path=url.pathname;
  if (path.endsWith("/")) path+="index.html";
  if (!ALLOWED.has(path)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if (event.request.mode==="navigate") {
      try {
        const response=await fetch(event.request);
        if (response.ok) {
          cache.put(path, response.clone());
          return response;
        }
      } catch {}
      return (await cache.match(path)) || Response.error();
    }
    const cached=await cache.match(path);
    if (cached) return cached;
    const response=await fetch(event.request);
    if (response.ok) cache.put(path, response.clone());
    return response;
  })());
});
`;
}
export async function buildOffline(root) {
  async function walk(dir) {
    const children = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        children.map((item) =>
          item.isDirectory()
            ? walk(join(dir, item.name))
            : [join(dir, item.name)],
        ),
      )
    ).flat();
  }
  const files = (await walk(root)).filter(
    (file) =>
      !["sw.js", "_headers", "_redirects"].includes(relative(root, file)),
  );
  const digest = createHash("sha256");
  for (const file of [...files].sort())
    digest.update(relative(root, file)).update(await readFile(file));
  const paths = files.map(
    (file) => "/" + relative(root, file).replaceAll("\\", "/"),
  );
  const cache = "ihurt-static-" + digest.digest("hex").slice(0, 16);
  await writeFile(join(root, "sw.js"), serviceWorkerSource(cache, paths));
  console.log(`Offline copy: ${paths.length} static files.`);
}
if (process.argv[1]?.endsWith("offline-build.mjs"))
  await buildOffline(process.argv[2] ?? "dist/app");
