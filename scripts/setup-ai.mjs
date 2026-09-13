import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    "Install Node.js 22.12 or newer, then run npm run setup again.",
  );
  process.exit(1);
}
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const uv = spawnSync("uv", ["--version"], {
  stdio: "ignore",
  shell: process.platform === "win32",
});
if (uv.error || uv.status !== 0) {
  console.error(
    "Install uv from https://docs.astral.sh/uv/getting-started/installation/ and run setup again.",
  );
  process.exit(1);
}
const template = await readFile(".env.example", "utf8");
try {
  await writeFile(
    ".env",
    template.replace(
      /^SESSION_SECRET=$/m,
      `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Created private local settings in .env. Optional AI settings are ready.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Keeping your existing .env settings.");
}
run("uv", ["sync", "--frozen", "--extra", "dev"]);
console.log("\nReady. Run npm run dev:ai, then open http://127.0.0.1:5173.");
