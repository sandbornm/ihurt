import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read only the synthetic artifacts produced by npm run profile:ios.
const directory = process.argv[2];
if (!directory) {
  console.error(
    "Usage: node scripts/ios-profile-report.mjs output/ios-profile/<run>",
  );
  process.exit(1);
}
const read = (name) =>
  JSON.parse(readFileSync(resolve(directory, name), "utf8"));
const environment = read("environment.json");
if (environment.exitCode !== 0)
  throw new Error(
    "This run did not finish successfully; do not report it as a completed session.",
  );
const { samples: timings } = read("timings.json");
const { samples: resources } = read("resources.json");
const round = (value) => Math.round(value * 100) / 100;
function usage(samples) {
  if (samples.length < 2) return null;
  const first = samples[0],
    last = samples.at(-1);
  const seconds = (last.unixMs - first.unixMs) / 1000;
  if (seconds <= 0 || last.cpuSeconds < first.cpuSeconds) return null;
  return {
    sampleCount: samples.length,
    coveredSeconds: round(seconds),
    cpuSeconds: round(last.cpuSeconds - first.cpuSeconds),
    cpuPercentOfOneCore: round(
      (100 * (last.cpuSeconds - first.cpuSeconds)) / seconds,
    ),
    rssMiB: {
      first: round(first.rssKiB / 1024),
      last: round(last.rssKiB / 1024),
      min: round(Math.min(...samples.map((s) => s.rssKiB)) / 1024),
      max: round(Math.max(...samples.map((s) => s.rssKiB)) / 1024),
    },
  };
}
console.log(
  JSON.stringify(
    {
      device: environment.device,
      recordedAt: environment.recordedAt,
      scope:
        "XCTest wall times include automation. CPU and RSS cover only WebContent after launch sampling, on the Mac simulator. Null means fewer than two samples. Phase edges between samples are excluded.",
      session: usage(resources),
      phases: timings.map((phase) => ({
        name: phase.name,
        observedSeconds: round(phase.durationMs / 1000),
        renderer: usage(
          resources.filter(
            (sample) =>
              sample.unixMs >= phase.startUnixMs &&
              sample.unixMs <= phase.startUnixMs + phase.durationMs,
          ),
        ),
      })),
    },
    null,
    2,
  ),
);
