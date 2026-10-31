// Runs the notebook storage race test that imports src/notebook-storage.ts.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "tests/capture-save-storage.test.ts",
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
