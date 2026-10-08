# Run iHurt

[← iHurt](../README.md)

The [browser notebook](https://ihurt.app/try/) opens with an editable example. Add as many entries as you need, keep notes on individual pins, and export a backup. No installation is required.

## Install locally

Install [Node.js](https://nodejs.org/en/download) **22.12 or newer**, Git, and
[uv](https://docs.astral.sh/uv/getting-started/installation/). The build uses uv
to prepare the bundled MediaPipe hand model; it can install Python if needed.

```bash
git clone https://github.com/sandbornm/ihurt.git
cd ihurt
npm run setup
npm start
```

Open **http://127.0.0.1:5173**. The notebook needs no Python API server or AI account. For development, use `npm run dev`.

Entries and the current draft save in this browser. Use **Notebook → Export notebook** for a JSON backup. **Import JSON** restores a version 2 export. **Print / Save PDF** opens a printout you can save as PDF. The SVG download is also printable.

The production build caches the app and anatomy files after its first complete load. Wait for the offline indicator before disconnecting. Browser storage can be cleared or evicted; private windows usually erase it when closed. Keep backups.

## iPhone and iPad

For a real iPhone plugged into another Mac, use the
[laptop installation handoff](IOS-LAPTOP-HANDOFF.md), including the current
branch and a prompt for a new Codex session.

On a Mac, also install Xcode 26 or later. Open Xcode and finish its required
components, then install an iOS Simulator runtime in Settings → Components.
The runtime download can be several GB; the SDK alone is not enough to run a
simulator.

```sh
npm run setup:ios
npm run ios:open
```

Setup installs locked dependencies, prepares the offline assets, runs the checks,
syncs Capacitor, and builds an unsigned Debug simulator app. It does not ask for
provider keys or signing credentials. Choose **iPhone 16 Pro** first and check an
iPad too. Xcode 27 displays simulators in **Device Hub**.

No Apple account is needed for Simulator. A free Apple Account in Xcode can be
used for initial physical-device tests; TestFlight and App Store distribution
require a paid Developer Program membership. Keep signing settings local.

After web or bundled-notice changes, run `npm run ios:sync`. Before a release,
also run `npm run ios:build -- --configuration Release` and the isolated browser
checks:

```sh
npx playwright install chromium
npm run test:ios-web
npm run test:ios-speech
npm run test:ios-native
npm run test:ios-native -- --device 'iPad (A16)'
```

The app packages anatomy GLBs, Draco and heat WASM, fonts, MediaPipe WASM and the
hand model, plus the credits and license notices from `public/models`,
`public/draco/LICENSE`, and `LICENSE`. Generated copies under `dist/app` and
`ios/App/App/public` stay out of git. Commit source assets, their attribution,
and the native `Package.resolved` when dependencies change. No private exports
or recordings belong in these folders.

See [IOS.md](IOS.md) for exports, offline storage, native build commands, and
the device checklist. The [validation record](IOS-VALIDATION.md) separates
simulator results from hardware work still needed.

## Optional AI tools

For manual AI sharing, export an entry as JSON and attach it to Grok, ChatGPT, Claude, or a local model. The entry includes anatomy model hashes, coordinates, pin labels, and comments. Copy the suggested prompt from **Share with AI** if helpful.

For an integrated provider, install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```bash
npm run setup:ai
npm run dev:ai
```

Setup creates a private `.env` without overwriting existing keys. Put the Grok key in `XAI_API_KEY`; configure other providers using the [provider guide](PROVIDERS.md). Keys stay on the local Python server. Cloud providers charge separately for usage; local models use your hardware.

## Optional voice drafts

Web recording uses ElevenLabs through the local Python server. Follow the
[voice setup guide](VOICE.md#web-and-local-server) for key permissions, `.env`
settings, costs, and a check that makes no paid request. Voice works with
`LLM_PROVIDER=demo`; you do not need another AI provider. Typed voice drafts and
Apple on-device speech on supported iPhones do not need an ElevenLabs key.

## Troubleshooting

- **AI tools unavailable:** run `npm run dev:ai`. Saving, editing, and exports work without this server.
- **Narrow layout:** the app uses one column below 670 pixels. Widen the browser panel or open the URL in a full browser window. Automated checks use their own browser.
- **Storage unavailable:** export before closing. Check browser storage permissions and available disk space.
- **Grok has no credits:** check xAI billing and spending limits. A key alone does not fund requests.
- **Offline copy not ready:** leave the page open while its anatomy files finish downloading. Offline caching is enabled in production builds, not the development server.
