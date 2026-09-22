# Run iHurt

[← iHurt](../README.md)

The [browser notebook](https://ihurt.app/try/) opens with an editable example. Add as many entries as you need, keep notes on individual pins, and export a backup. No installation is required.

## Install locally

Install [Node.js](https://nodejs.org/en/download) **22.12 or newer** and Git.

```bash
git clone https://github.com/sandbornm/ihurt.git
cd ihurt
npm run setup
npm start
```

Open **http://127.0.0.1:5173**. This runs the notebook without Python or an AI account. For development, use `npm run dev`.

Entries and the current draft save in this browser. Use **Notebook → Export notebook** for a JSON backup. **Import JSON** restores a version 2 export. **Print / Save PDF** opens a printout you can save as PDF. The SVG download is also printable.

The production build caches the app and anatomy files after its first complete load. Wait for the offline indicator before disconnecting. Browser storage can be cleared or evicted; private windows usually erase it when closed. Keep backups.

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
