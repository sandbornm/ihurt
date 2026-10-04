import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    device: { type: "string", default: "iPhone 16 Pro" },
    help: { type: "boolean" },
    profile: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    'Usage: npm run test:ios-native -- [--device "iPhone 16 Pro"|"iPad (A16)"] [--profile]\nRun ios:sync first. Creates and deletes a fresh simulator; never uses an existing notebook.\n--profile uses Release, records synthetic screen video and a WebContent Time Profiler trace, and replays a longer user session.',
  );
  process.exit(0);
}
function simctl(...args) {
  const result = spawnSync("xcrun", ["simctl", ...args], {
    encoding: "utf8",
    timeout: 60000,
  });
  if (result.status !== 0)
    throw new Error(
      result.error?.message ||
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
const output = values.profile
  ? resolve("output/ios-profile", run)
  : resolve("output/ios-native");
mkdirSync(output, { recursive: true });
const resultPath = resolve(output, `${run}.xcresult`);
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
const recorders = [];
const resources = [];
let resourceTimer;
function sampleRenderer(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "time=,rss="], {
    encoding: "utf8",
    timeout: 2000,
  });
  const fields = result.stdout?.trim().split(/\s+/);
  if (result.status !== 0 || fields?.length !== 2) return;
  const cpuSeconds = fields[0]
    .split(":")
    .map(Number)
    .reduce((sum, part) => sum * 60 + part, 0);
  const rssKiB = Number(fields[1]);
  if (Number.isFinite(cpuSeconds) && Number.isFinite(rssKiB))
    resources.push({ unixMs: Date.now(), cpuSeconds, rssKiB });
}
function record(name, args) {
  const log = openSync(resolve(output, `${name}.log`), "w");
  const child = spawn("xcrun", args, { stdio: ["ignore", log, log] });
  closeSync(log);
  const done = new Promise((resolve) => {
    child.once("error", () => resolve(-1));
    child.once("close", (code) => resolve(code));
  });
  recorders.push({ name, child, done });
}
const metadata = {
  recordedAt: new Date().toISOString(),
  device: values.device,
  simulatorId: id,
  runtime: runtime.version,
  runtimeBuild: runtime.buildversion,
  configuration: values.profile ? "Release" : "Debug",
  gitCommit: spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim(),
  modifiedPaths: spawnSync("git", ["diff", "--name-only"], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")
    .filter(Boolean),
  host: {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryBytes: totalmem(),
    darwin: release(),
    architecture: process.arch,
  },
  xcode: spawnSync("xcodebuild", ["-version"], {
    encoding: "utf8",
  }).stdout.trim(),
  scope:
    "Fresh simulator only. Time Profiler attaches only to its WebContent renderer after launch sampling. UIKit host/GPU processes are not included. Host hardware is not an iPhone/iPad performance baseline.",
};
async function startRendererProfile() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const jobs = simctl("spawn", id, "launchctl", "list");
    const app = jobs
      .split("\n")
      .find((line) => /UIKitApplication:app\.ihurt\.notebook\[/.test(line));
    const appPid = Number(app?.trim().split(/\s+/)[0]);
    const parent =
      appPid > 0
        ? Number(
            spawnSync("ps", ["-p", String(appPid), "-o", "ppid="], {
              encoding: "utf8",
            }).stdout.trim(),
          )
        : 0;
    // XPC WebContent jobs are not listed by launchctl list. Restrict discovery
    // to this app or its own simulator launchd; never attach by global name.
    const processes =
      parent > 1
        ? spawnSync("ps", ["-A", "-o", "pid=,ppid=,comm="], {
            encoding: "utf8",
          }).stdout
        : "";
    const matches = processes
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
      .filter(
        (row) =>
          row &&
          [appPid, parent].includes(Number(row[2])) &&
          /WebKit.*WebContent/.test(row[3]),
      );
    const pids = [
      ...new Set(
        matches
          .map((row) => Number(row[1]))
          .filter((pid) => Number.isInteger(pid) && pid > 0),
      ),
    ];
    if (pids.length === 1) {
      metadata.appPid = appPid;
      metadata.simulatorLaunchdPid = parent;
      metadata.rendererPid = pids[0];
      metadata.traceRequestedAtUnixMs = Date.now();
      sampleRenderer(pids[0]);
      resourceTimer = setInterval(() => sampleRenderer(pids[0]), 1000);
      console.log(
        `Profiling WebContent PID ${pids[0]} in the disposable simulator.`,
      );
      record("time-profiler", [
        "xctrace",
        "record",
        "--template",
        "Time Profiler",
        "--device",
        id,
        "--attach",
        String(pids[0]),
        "--time-limit",
        "10m",
        "--output",
        resolve(output, "session.trace"),
      ]);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Could not uniquely identify this test simulator's WebContent process. No broader capture was started.",
  );
}

async function runTests(args) {
  const child = spawn("xcodebuild", args, {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let pending = "",
    profileStarted,
    interrupted = false;
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    pending = (pending + chunk).slice(-4096);
    if (
      values.profile &&
      !profileStarted &&
      pending.includes("IHURT_PROFILE_READY")
    ) {
      profileStarted = startRendererProfile().catch((error) => {
        console.error(error.message);
        return false;
      });
    }
  });
  const interrupt = () => {
    interrupted = true;
    child.kill("SIGINT");
  };
  process.once("SIGINT", interrupt);
  const timeout = setTimeout(() => child.kill("SIGTERM"), 900000);
  const result = await new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
  clearTimeout(timeout);
  process.removeListener("SIGINT", interrupt);
  await profileStarted;
  return interrupted ? 130 : result;
}
try {
  simctl("boot", id);
  console.log(
    "Waiting for the new simulator to finish booting (up to five minutes)…",
  );
  const boot = spawnSync("xcrun", ["simctl", "bootstatus", id, "-b"], {
    stdio: "inherit",
    timeout: 300000,
  });
  if (boot.status !== 0)
    throw new Error(boot.error?.message || "Simulator boot did not finish.");
  if (values.profile) {
    writeFileSync(
      resolve(output, "environment.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    record("screen", [
      "simctl",
      "io",
      id,
      "recordVideo",
      "--codec=h264",
      resolve(output, "session.mp4"),
    ]);
  }
  console.log(
    "Building and starting XCTest. Hosted Xcode can take several minutes to prepare its first test runner.",
  );
  status = await runTests([
    "-project",
    "ios/App/App.xcodeproj",
    "-scheme",
    "App",
    "-configuration",
    metadata.configuration,
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
    "-test-timeouts-enabled",
    "YES",
    "-maximum-test-execution-time-allowance",
    values.profile ? "600" : "300",
    values.profile
      ? "-only-testing:NotebookUITests/NotebookUITests/testProfileNotebookSession"
      : "-only-testing:NotebookUITests/NotebookUITests/testNotebookSurvivesRelaunchAndBackground",
    "CODE_SIGNING_ALLOWED=NO",
    "test",
  ]);
  if (values.profile && !metadata.rendererPid) status = status || 1;
} finally {
  try {
    clearInterval(resourceTimer);
    if (values.profile && resources.length < 2) {
      console.error(
        "The renderer profile did not collect enough CPU/memory samples.",
      );
      status = status || 1;
    }
    for (const recorder of recorders) {
      recorder.child.kill("SIGINT");
      const timeout = setTimeout(() => recorder.child.kill("SIGKILL"), 120000);
      const code = await recorder.done;
      clearTimeout(timeout);
      if (code !== 0) {
        console.error(
          `${recorder.name} did not finish successfully. Inspect ${output}/${recorder.name}.log.`,
        );
        status = status || 1;
      }
    }
    if (values.profile)
      writeFileSync(
        resolve(output, "resources.json"),
        JSON.stringify(
          {
            scope:
              "WebContent renderer only. ps cumulative CPU seconds and resident KiB sampled approximately once per second. Not whole-app footprint or physical-device memory.",
            samples: resources,
          },
          null,
          2,
        ) + "\n",
      );
    if (values.profile && existsSync(resultPath)) {
      const attachments = resolve(output, "attachments");
      const exported = spawnSync(
        "xcrun",
        [
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          resultPath,
          "--output-path",
          attachments,
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      if (exported.status === 0) {
        const manifest = JSON.parse(
          readFileSync(resolve(attachments, "manifest.json"), "utf8"),
        );
        const timing = manifest
          .flatMap((test) => test.attachments)
          .find((a) =>
            a.suggestedHumanReadableName.startsWith(
              "Simulator profile timings",
            ),
          );
        if (timing)
          copyFileSync(
            resolve(attachments, timing.exportedFileName),
            resolve(output, "timings.json"),
          );
        else {
          console.error(
            "The profile test did not attach its completed timings.",
          );
          status = status || 1;
        }
      } else {
        console.error("Could not export profile attachments:", exported.stderr);
        status = status || 1;
      }
      writeFileSync(
        resolve(output, "environment.json"),
        JSON.stringify({ ...metadata, exitCode: status }, null, 2) + "\n",
      );
    }
  } catch (error) {
    console.error("Could not finalize profile artifacts:", error.message);
    status = status || 1;
  } finally {
    // Only this process's newly-created device is eligible for deletion.
    spawnSync("xcrun", ["simctl", "shutdown", id], {
      stdio: "ignore",
      timeout: 60000,
    });
    simctl("delete", id);
  }
}
console.log(`Native test results: ${resultPath}`);
if (values.profile)
  console.log(`Profile, recording, timings, and environment: ${output}`);
process.exitCode = status;
