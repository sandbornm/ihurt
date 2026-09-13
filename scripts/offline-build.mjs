import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
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
  await writeFile(
    join(root, "sw.js"),
    `const CACHE=${JSON.stringify(cache)};\nconst PATHS=${JSON.stringify(paths)};\nconst ALLOWED=new Set(PATHS);\nself.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PATHS.map(path=>new Request(path,{credentials:'omit'}))))));\nself.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('ihurt-static-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));\nself.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;let path=url.pathname;if(path.endsWith('/'))path+='index.html';if(!ALLOWED.has(path))return;event.respondWith((async()=>{const cache=await caches.open(CACHE);if(event.request.mode==='navigate'){try{const response=await fetch(event.request);if(response.ok)return response;}catch{}return (await cache.match(path))||Response.error();}return (await cache.match(path))||fetch(event.request);})());});\n`,
  );
  console.log(`Offline copy: ${paths.length} static files.`);
}
if (process.argv[1]?.endsWith("offline-build.mjs"))
  await buildOffline(process.argv[2] ?? "dist/app");
