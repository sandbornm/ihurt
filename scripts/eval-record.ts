// Records on-device Apple Intelligence output for the extraction eval.
// macOS only. The Swift tool calls the same extract function as the app.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { anatomyList } from "../src/voice/extraction.ts";

if (process.platform !== "darwin") {
  console.error(
    "eval:record needs macOS with Apple Intelligence. This machine cannot record on-device model output.",
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    limit: { type: "string" },
    cases: {
      type: "string",
      default: "tests/fixtures/extraction-eval/cases.json",
    },
  },
});

if (!values.name || !/^[a-z0-9][a-z0-9-]*$/.test(values.name)) {
  console.error(
    "Usage: npm run eval:record -- --name <name> [--limit N] [--cases path]",
  );
  process.exit(1);
}

const root = process.cwd();
const outDir = resolve(root, "output/extraction-eval");
mkdirSync(outDir, { recursive: true });
mkdirSync(resolve(root, "tests/fixtures/extraction-eval/recorded"), {
  recursive: true,
});
const anatomyPath = resolve(outDir, "anatomy.json");
writeFileSync(anatomyPath, JSON.stringify(anatomyList));
const binary = resolve(outDir, "fm-eval");
const compiled = spawnSync(
  "xcrun",
  [
    "swiftc",
    "-parse-as-library",
    "-O",
    "ios/App/App/PainExtractionModel.swift",
    "tools/extraction-eval/main.swift",
    "-o",
    binary,
  ],
  { cwd: root, encoding: "utf8" },
);
if (compiled.status !== 0) {
  console.error(compiled.stderr || compiled.stdout || "swiftc failed");
  process.exit(compiled.status ?? 1);
}

const outPath = resolve(
  root,
  "tests/fixtures/extraction-eval/recorded",
  `${values.name}.json`,
);
const args = [
  "--cases",
  resolve(root, values.cases),
  "--anatomy",
  anatomyPath,
  "--out",
  outPath,
  "--name",
  values.name,
];
if (values.limit) args.push("--limit", values.limit);
const ran = spawnSync(binary, args, { cwd: root, stdio: "inherit" });
process.exit(ran.status ?? 1);
