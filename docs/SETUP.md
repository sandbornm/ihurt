# Install and run ihurt

[← ihurt](../README.md)

## Quick start

Install [Node.js](https://nodejs.org/en/download) **22.12 or newer**, [uv](https://docs.astral.sh/uv/getting-started/installation/), and Git. uv uses Python 3.12 or newer and can install a suitable version if needed.

```bash
git clone https://github.com/sandbornm/ihurt.git
cd ihurt
npm run setup
npm run dev
```

Open **http://127.0.0.1:5173**. **Demo mode** works without an account, model, or API key. It uses simple rules on your local server; it is not AI.

1. Zoom in and place up to six pins. Use landmarks or the region picker to find a spot. Add a note or choose an example.
2. Choose demo mode or a configured AI provider. Review the data-use notice before sending a cloud request.
3. Make your map. If the location or activity is unclear, the app asks up to two follow-up questions. You can edit the note afterward.
4. Choose reading sources, then download the map as an **SVG image** or **JSON file**. SVGs open in a browser and can be printed or saved as PDFs through the browser’s print dialog.

“Save for this visit” keeps a map in the tab’s memory. **Refresh or close the tab and the journal clears.** Download anything you want to keep. There is no email delivery or persistent symptom database.

To connect an AI model, follow the [provider guide](PROVIDERS.md).

## Troubleshooting

- **API unavailable:** use `npm run dev`, not just `npm run dev:web`. The full command starts both services.
- **Preview looks like a phone:** the app uses one column below 670 pixels. Widen the browser panel or open the local URL in a full browser window. Automated browser checks use separate headless windows and never resize your preview.
- **Provider is disabled:** fill its key or local model name in `.env` and restart the Python server. Keys never go in the UI.
- **Grok reports no credits or a spending limit:** check billing in your xAI account. A valid key alone does not fund API requests. Retrying the same map keeps its activity allowance.
- **Local mapping times out:** confirm the model server is running, the name matches its loaded model, and your hardware can run it. Choose a model that can follow a JSON schema.
- **An activity expired after a restart:** setup creates a stable session secret. If you skipped setup and left `SESSION_SECRET` blank, the development secret changes at startup. Keep a stable random secret in `.env` for quota sessions across restarts. Symptom notes still clear on page refresh.
- **Daily allowance reached:** the development guard is intentional; adjust `.env` for your own use. It resets at midnight UTC.
- **Microphone unavailable:** try localhost/HTTPS and check browser permissions. You can always type.
