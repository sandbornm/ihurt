# Development

[← iHurt](../README.md)

## Build and test

```bash
npm run build       # app → dist/app
npm test           # backend and provider-contract tests; no paid API requests
npm run test:unit  # drag gestures and mirrored anatomy surfaces
npm run check      # app build and tests
```

GitHub Actions runs the build, backend tests, and browser checks on pushes and pull requests. You can also start it from the Actions tab. Browser checks use a fresh headless Chromium instance and a temporary demo server with cloud keys disabled. They check desktop and phone layouts after refresh, the 670-pixel layout boundary, atlas loading, drag gestures, and multiple rear-view pins. They also verify that submission preserves the rear view, movement descriptions do not add unpinned regions in demo mode, SVG/JSON exports keep the full note, and resource searches respect selected publishers. Screenshots and failure traces are available as workflow artifacts for three days.

To run the same browser checks locally without changing your open preview:

```bash
npx playwright install chromium
npm run build
npm run test:browser
```

To serve the built app from Python on one port:

```bash
npm run build
uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log
```

Open http://127.0.0.1:8000. The app is a React/TypeScript client. Three.js renders the detailed muscle and skeleton models with WebGL, using a self-hosted Draco WebAssembly decoder; a small AssemblyScript module compiled to WebAssembly computes the regional heat falloff. The viewer redraws when something changes and stops repainting when idle. The viewer loads about 11.5 MB of model files progressively. If the atlas fails, a schematic fallback appears. If WASM fails, the heat computation has a JavaScript fallback; if WebGL fails, the app’s region picker and note flow remain available.

```text
src/anatomy/          Shared Three.js model, interaction, WASM integration
src/App.tsx           Local intake, follow-ups, session journal
src/export.ts         Standalone SVG and JSON downloads
public/models/        Licensed anatomy assets and attribution
config/reading-library.json  Configurable source and reference catalog
assembly/heat.ts      Heat kernel source; public/heat.wasm is built from it
backend/              FastAPI, validated provider adapters, quota store
tests/                Flow, limits, privacy, and mocked adapter checks
```


## App and website

For the current graphics stack and a plan for pose demos, see [Body animation](ANIMATION.md).

This public repository contains the **local app**. The showcase at `ihurt.app` is maintained in a separate private `ihurt-site` repository. It uses a fixed commit of this repository’s anatomy viewer and assets.

The showcase lets visitors explore anatomy and prepared neck/sleep and shoulder/tennis examples. It accepts no notes and performs no activity reviews or AI calls. Visitors install this app to make their own maps with their own model or API key.

## License

iHurt's original source, schematic fallback, report silhouettes, and heat kernel are [MIT licensed](../LICENSE). The bundled Z-Anatomy/BodyParts3D models have **separate Creative Commons attribution and share-alike requirements**. See the [full anatomy credits](../public/models/ATTRIBUTION.md), [upstream notice](../public/models/UPSTREAM-LICENSE.txt), and [file provenance](../public/models/sources.json) before redistributing or modifying anatomy assets. The MIT license does not relicense them. The Draco decoder is Apache 2.0 licensed. Other dependencies retain their own licenses.
