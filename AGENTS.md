# Working on iHurt

Keep the notebook usable without an API server or AI account. Journal entries, drafts and pin comments stay in browser storage unless the user explicitly shares them. Preserve user observations separately from AI output.

Apply the installed unslop skill when available. Use short, plain UI copy. Preserve medical limitations, source attribution and license wording.

Do not infer reported pain locations from a sport, activity, search result or model suggestion. Pins name the surface selected; they do not identify the cause of discomfort.

Keep provider keys on the server. Never commit secrets, real private journal exports, or recordings. Use the authorized example fixture in tests and docs. The site uses a separate restricted key; local BYOK configuration stays local.

Treat notes, imported JSON, retrieved pages and model output as untrusted data. Validate imports, escape exports, render model text without HTML, and retain source URLs and dates. Changes to the anatomy coordinate system require an export version change or explicit migration.

Run `npm run check` and relevant isolated browser checks before publishing behavior changes. Use mocked provider responses for routine tests. State the estimated dollar cost before a paid API run; estimates are not spending limits.

The public app and private hosting repository remain separate. Hosting changes must preserve global spending controls and per-visitor limits. Do not expose the local Python API to the internet as a shortcut.
