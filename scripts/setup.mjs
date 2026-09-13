import { spawnSync } from "node:child_process";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error("Install Node.js 22.12 or newer, then run setup again.");
  process.exit(1);
}
for (const args of [["ci"], ["run", "build"]]) {
  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log(
  "Ready. Run npm start to open your notebook at http://127.0.0.1:5173.",
);
