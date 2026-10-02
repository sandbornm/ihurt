import { spawnSync } from "node:child_process";
const ios = process.argv.includes("--ios");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error("Install Node.js 22.12 or newer, then run setup again.");
  process.exit(1);
}
if (ios) {
  const xcode = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
  if (
    process.platform !== "darwin" ||
    xcode.status !== 0 ||
    Number(xcode.stdout?.match(/Xcode (\d+)/)?.[1] ?? 0) < 26
  ) {
    console.error(
      "Install Xcode 26 or later on a Mac and finish its required-component setup. See docs/IOS.md.",
    );
    process.exit(1);
  }
}
const uv = spawnSync("uv", ["--version"], { stdio: "ignore" });
if (uv.error || uv.status !== 0) {
  console.error(
    "Install uv to prepare the bundled hand model, then run setup again. See docs/SETUP.md.",
  );
  process.exit(1);
}
if (ios) {
  const python = spawnSync("uv", ["sync", "--frozen", "--extra", "dev"], {
    stdio: "inherit",
  });
  if (python.error || python.status !== 0) process.exit(python.status || 1);
}
const steps = ios
  ? [
      ["ci"],
      ["run", "check"],
      ["exec", "--", "cap", "sync", "ios"],
      ["run", "ios:build"],
    ]
  : [["ci"], ["run", "build"]];
for (const args of steps) {
  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log(
  ios
    ? "Unsigned iOS build ready. Run npm run ios:open and choose an iPhone 16 Pro or iPad simulator. Install an iOS Simulator runtime in Xcode if none is available. See docs/IOS.md."
    : "Ready. Run npm start to open your notebook at http://127.0.0.1:5173.",
);
