import { spawnSync } from "node:child_process";

const version = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
const major = Number(version.stdout?.match(/Xcode (\d+)/)?.[1]);
if (version.status !== 0 || major < 26 || !Number.isFinite(major)) {
  console.error(
    "Install Xcode 26 or later and select it with xcode-select. Apple Command Line Tools alone cannot build iOS apps. See docs/IOS.md.",
  );
  process.exit(1);
}
const build = spawnSync(
  "xcodebuild",
  [
    "-project",
    "ios/App/App.xcodeproj",
    "-scheme",
    "App",
    "-configuration",
    "Debug",
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    "ios/DerivedData",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ],
  { stdio: "inherit" },
);
process.exit(build.status ?? 1);
