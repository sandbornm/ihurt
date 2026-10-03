import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    device: { type: "string", default: "iPhone 16 Pro" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    'Usage: npm run test:ios-native -- [--device "iPhone 16 Pro"|"iPad (A16)"]\nRun ios:sync first. Creates and deletes a fresh simulator; never uses an existing notebook.',
  );
  process.exit(0);
}
function simctl(...args) {
  const result = spawnSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      result.stderr ||
        "simctl failed. Install an iOS Simulator runtime in Xcode.",
    );
  return result.stdout.trim();
}
if (!existsSync("ios/App/App/public/index.html")) {
  throw new Error("Run npm run ios:sync before the native checks.");
}
const device = JSON.parse(
  simctl("list", "devicetypes", "--json"),
).devicetypes.find((d) => d.name === values.device);
if (!device)
  throw new Error(`Simulator device type not installed: ${values.device}`);
const runtime = JSON.parse(simctl("list", "runtimes", "--json"))
  .runtimes.filter(
    (r) =>
      r.isAvailable &&
      r.identifier.includes(".iOS-") &&
      r.supportedDeviceTypes?.some((d) => d.identifier === device.identifier),
  )
  .sort((a, b) =>
    b.version.localeCompare(a.version, undefined, { numeric: true }),
  )[0];
if (!runtime)
  throw new Error(
    `Install an iOS Simulator runtime supporting ${values.device} in Xcode Settings → Components.`,
  );

const run = `${values.device.replaceAll(/[^a-z0-9]+/gi, "-")}-${Date.now()}`;
const resultPath = resolve("output/ios-native", `${run}.xcresult`);
mkdirSync(resolve("output/ios-native"), { recursive: true });
const id = simctl(
  "create",
  `iHurt test ${run}`,
  device.identifier,
  runtime.identifier,
);
console.log(
  `Testing ${values.device} on iOS ${runtime.version} in disposable simulator ${id}`,
);
let status = 1;
try {
  simctl("boot", id);
  simctl("bootstatus", id, "-b");
  const result = spawnSync(
    "xcodebuild",
    [
      "-project",
      "ios/App/App.xcodeproj",
      "-scheme",
      "App",
      "-configuration",
      "Debug",
      "-destination",
      `platform=iOS Simulator,id=${id}`,
      "-derivedDataPath",
      "ios/DerivedData",
      "-resultBundlePath",
      resultPath,
      "-disableAutomaticPackageResolution",
      "-parallel-testing-enabled",
      "NO",
      "-collect-test-diagnostics",
      "never",
      "CODE_SIGNING_ALLOWED=NO",
      "test",
    ],
    { stdio: "inherit" },
  );
  status = result.status ?? 1;
} finally {
  // Only this process's newly-created device is eligible for deletion.
  spawnSync("xcrun", ["simctl", "shutdown", id], { stdio: "ignore" });
  simctl("delete", id);
}
console.log(`Native test results: ${resultPath}`);
process.exitCode = status;
