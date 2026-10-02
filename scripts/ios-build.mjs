import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    configuration: { type: "string", default: "Debug" },
    device: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "Usage: npm run ios:build -- [--configuration Debug|Release] [--device]\nBuilds without signing. Run npm run ios:sync after web changes.",
  );
  process.exit(0);
}
if (!["Debug", "Release"].includes(values.configuration)) {
  console.error("Configuration must be Debug or Release.");
  process.exit(1);
}

const version = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
const major = Number(version.stdout?.match(/Xcode (\d+)/)?.[1]);
if (version.status !== 0 || major < 26 || !Number.isFinite(major)) {
  console.error(
    "Install Xcode 26 or later and select it with xcode-select. Apple Command Line Tools alone cannot build iOS apps. See docs/IOS.md.",
  );
  process.exit(1);
}
if (!existsSync("ios/App/App/public/index.html")) {
  console.error("Bundled web assets are missing. Run npm run ios:sync first.");
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
    values.configuration,
    "-sdk",
    values.device ? "iphoneos" : "iphonesimulator",
    "-destination",
    values.device ? "generic/platform=iOS" : "generic/platform=iOS Simulator",
    "-derivedDataPath",
    "ios/DerivedData",
    "-disableAutomaticPackageResolution",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ],
  { stdio: "inherit" },
);
process.exit(build.status ?? 1);
