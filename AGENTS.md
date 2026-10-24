# Working on iHurt

Keep the notebook usable without an API server or AI account. Journal entries, drafts and pin comments stay in browser storage unless the user explicitly shares them. Preserve user observations separately from AI output.

Apply the installed unslop skill when available. Use short, plain UI copy. Preserve medical limitations, source attribution and license wording.

Do not infer reported pain locations from a sport, activity, search result or model suggestion. Pins name the surface selected; they do not identify the cause of discomfort.

Keep provider keys on the server. Never commit secrets, real private journal exports, or recordings. Use the authorized example fixture in tests and docs. The site uses a separate restricted key; local BYOK configuration stays local.

Treat notes, imported JSON, retrieved pages and model output as untrusted data. Validate imports, escape exports, render model text without HTML, and retain source URLs and dates. Changes to the anatomy coordinate system require an export version change or explicit migration.

Run `npm run check` and relevant isolated browser checks before publishing behavior changes. Use mocked provider responses for routine tests. State the estimated dollar cost before a paid API run; estimates are not spending limits.

All provider calls go through `backend/spend_gate.py`, including LLM and TypeSafe calls.
`tests/test_spend_gate.py` fails if any other module under `backend/` or `evals/` constructs or calls a provider client.
Any eval runner must print its cost estimate and require `--yes` before paid calls, routed through the same gate.

The public app and private hosting repository remain separate. Hosting changes must preserve global spending controls and per-visitor limits. Do not expose the local Python API to the internet as a shortcut.

## Code Review Rules

Report actionable regressions introduced by the change. For each finding, identify
the affected code, the triggering scenario, the consequence, and a safe correction.
Point to an existing test or suggest a focused regression check when useful. State
assumptions and checks you could not run. Avoid speculative redesigns and style-only
findings; the rules below supplement ordinary correctness and security review.

### Private, optional sharing

Keep notebook editing and saved entries usable without a server or AI account.
Changes to research, voice, feedback, or sharing must send only the fields the user
explicitly chooses in that flow. Do not upload other entries, pin comments,
recordings, or provider keys through analytics or background requests. Preserve
the reviewed sharing preview and local fallback when optional services fail.

### Saved entries and portable maps

Check storage, import/export, and anatomy changes against existing saved entries
and `.ihm` maps. Preserve drafts and pin coordinates; a coordinate-system change
needs a versioned format or explicit migration. Imports must validate untrusted
data, and exports must escape user text. A late research response must not restore
a deleted entry or overwrite a newer draft (`src/notebook-storage.ts`).

### Observations and generated interpretations

Keep the user's selected surface, reported feeling, and original text separate
from AI interpretation. Activity names, search results, and model suggestions must
not create reported pain locations or diagnoses. Preserve source attribution and
medical limitations when changing anatomy labels, generated text, or exports.
