# Development

[← iHurt](../README.md)

## Build and test

```bash
npm run build       # app → dist/app
npm test           # backend and provider-contract tests; no paid API requests
npm run test:unit  # drag gestures and mirrored anatomy surfaces
npm run check      # app build and tests
```

`npm run build` fetches the MediaPipe hand landmarker into `public/mediapipe/` (SIMD wasm from the npm package, model from Google). Hands control is optional and runs in the browser. Browser checks spoof landmarks with a `window` `ihurt:hands` event so they do not need a camera.

### Hands test notes

- Navigation thresholds live in `HAND_TUNING` in `src/anatomy/hands.ts`. `hand-entry.ts` owns the timed pin, relative wrist dial, and save workflow, with its own `HAND_ENTRY_TUNING`. `HandEntryPanel.tsx` renders feedback; `HandCamera.tsx` connects landmarks to the workflow and notebook callbacks.
- During a Hands session, **Copy hands log** copies a local TSV of pose/action labels and normalized cursor positions. It contains no images or recordings. Add a note about what you intended when reporting a gesture issue.
- Camera checks use synthetic landmarks and mocked media streams. They cover tracking loss, hold cancellation, dial jitter and regripping, one save per gesture, failed saves, and camera cleanup. Browser checks verify that a point-and-hold creates an actual pin without a mouse-confirmed layer picker, changes intensity, and saves it to IndexedDB. Synthetic checks do not establish recognition accuracy with a real camera; user camera feedback is still needed when tuning gestures.

GitHub Actions builds the app and runs backend, unit, and isolated browser checks. Browser checks use a Node static preview with no API server. They cover multiple entries, editing, refresh, exports, offline anatomy and storage, and desktop/phone layout. Tests make no paid requests.

To run the same browser checks locally without changing your open preview:

```bash
npx playwright install chromium
npm run build
npm run test:browser
npm run test:controls
```

To serve the built app from Python on one port:

```bash
npm run build
uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log
```

Open http://127.0.0.1:8000. The app is a React/TypeScript client. Three.js renders the detailed muscle and skeleton models with WebGL, using a self-hosted Draco WebAssembly decoder; a small AssemblyScript module compiled to WebAssembly computes the regional heat falloff. The viewer redraws when something changes and stops repainting when idle. The viewer loads about 11.5 MB of model files progressively. If the atlas fails, a schematic fallback appears. If WASM fails, the heat computation has a JavaScript fallback; if WebGL fails, the app’s region picker and note flow remain available.

```text
src/anatomy/          Shared Three.js model, interaction, WASM integration
src/Notebook.tsx      Offline journal, pins, editing and sharing
src/AIOptions.tsx     Optional local API integration
src/export.ts         JSON bundles, viewport PNG, and print/PDF output
public/models/        Licensed anatomy assets and attribution
config/reading-library.json  Configurable source and reference catalog
assembly/heat.ts      Heat kernel source; public/heat.wasm is built from it
backend/              FastAPI, validated provider adapters, quota store
packages/ihurt-mcp/    Optional stdio MCP server for selected journal exports
tests/                Flow, limits, privacy, and mocked adapter checks
```

## App and website

The [MCP package](MCP.md) has its own `uv.lock`, build, and CI checks. It shares
the notebook export contract without adding dependencies to the app or web API.

For the current graphics stack and a plan for pose demos, see [Body animation](ANIMATION.md).

This public repository contains the **local app**. The showcase at `ihurt.app` is maintained in a separate private `ihurt-site` repository. It uses a fixed commit of this repository’s anatomy viewer and assets.

The site imports the shared notebook without the local provider integration. `/try/` starts with an editable example and stores entries in the visitor's browser. The landing page and deployment code remain in the private repository.

## License

iHurt's original source, schematic fallback, report silhouettes, and heat kernel are [MIT licensed](../LICENSE). The bundled Z-Anatomy/BodyParts3D models have **separate Creative Commons attribution and share-alike requirements**. See the [full anatomy credits](../public/models/ATTRIBUTION.md), [upstream notice](../public/models/UPSTREAM-LICENSE.txt), and [file provenance](../public/models/sources.json) before redistributing or modifying anatomy assets. The MIT license does not relicense them. The Draco decoder is Apache 2.0 licensed. Other dependencies retain their own licenses.
