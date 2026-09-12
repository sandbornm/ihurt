# ihurt

**Sit like a shrimp all day? Wake up sore from apparently nothing?**

ihurt lets you show exactly where you feel discomfort. Zoom from a body region to a named muscle, pin the spot, and add a note about what you were doing. Your chosen model organizes those observations into a personal **hurt map**, with curated reading to explore further.

Free source code. Run it on your computer. Use a local model or bring your own API key.

## Not medical advice

**ihurt is not medical advice whatsoever. It does not diagnose, treat, cure, mitigate, or prevent any disease, injury, or condition.** It is an experimental tool for education and personal reflection, not intended for use as a medical device, clinical assessment, or substitute for a qualified healthcare professional.

Do not use a hurt map to choose treatment, exercises, stretches, medication, or whether to seek care. The app does not prescribe any of these. Do not delay professional care because of its output. The model can misunderstand you, omit important details, or produce incorrect information.

The anatomy uses Z-Anatomy and BodyParts3D muscle and skeleton models, with approximate region boundaries. ihurt has not clinically validated the models, labels, pins, or heat overlays. Colors reflect **reported discomfort**, not tissue damage, a diagnosis, a nerve pathway, or disease probability. The app cannot determine whether pain is muscular, neurological, or caused by another condition.

If you have sudden chest pain, trouble breathing, new weakness, or loss of bladder or bowel control, seek emergency help. The app cannot assess emergencies; its keyword reminder is incomplete and can be wrong. See the [NHS guidance on back pain and warning signs](https://www.nhs.uk/conditions/back-pain/).

## App and website

This public repository contains the **local app**. The showcase at `ihurt.app` is maintained in a separate private `ihurt-site` repository. It reuses a pinned version of the public anatomy viewer and assets.

The showcase lets visitors explore anatomy and prepared neck/sleep and shoulder/tennis examples. It accepts no notes and performs no activity reviews or AI calls. Visitors install this app to make their own maps. There is no shared public AI account to abuse or charge.

## Quick start

Install [Node.js](https://nodejs.org/en/download) **22.12 or newer**, [uv](https://docs.astral.sh/uv/getting-started/installation/), and Git. uv uses Python 3.12 or newer and can install a suitable version if needed.

```bash
git clone https://github.com/sandbornm/ihurt.git
cd ihurt
npm run setup
npm run dev
```

Open **http://127.0.0.1:5173**. You can use the complete mapping flow immediately in **demo mode**, without an account, model, or API key. Demo mode uses simple rules on your local server; it is not AI.

1. Choose a landmark or use the region picker. Zoom, rotate, and click up to six precise spots on the body. Add a note or choose an example.
2. Select a configured provider. Review the data-use notice before cloud requests.
3. Get an initial map immediately when the location and activity are clear. The app asks at most two useful clarifying questions. You can edit or add context afterward.
4. Choose reading sources, then download the map as an **SVG image** or **JSON file**. SVGs open in a browser and can be printed or saved as PDFs through the browser’s print dialog.

“Keep in this session” adds a map to the in-memory journal. **Refresh or close the tab and the journal clears.** Download anything you want to keep. There is no email delivery or persistent symptom database.

## Use a local model

Start an OpenAI-compatible server on your own hardware. The server must accept `/v1/chat/completions` and the model must produce valid JSON matching the map schema.

`npm run setup` creates a private `.env` file and a random session secret, without overwriting existing settings. Edit that file:

For **Ollama**, set these in `.env`:

```dotenv
LLM_PROVIDER=local
LOCAL_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_MODEL=your-installed-model
```

Replace `your-installed-model` with an exact model name from `ollama list`. Start Ollama, then restart `npm run dev`. See [Ollama’s OpenAI compatibility documentation](https://docs.ollama.com/api/openai-compatibility).

For **LM Studio**, load a model, start its local API server, and set:

```dotenv
LLM_PROVIDER=local
LOCAL_BASE_URL=http://127.0.0.1:1234/v1
LOCAL_MODEL=your-loaded-model-id
```

Other OpenAI-compatible servers use the same settings. Set `LOCAL_API_KEY` if your server requires a token. Set `LOCAL_JSON_MODE=false` only if it rejects `response_format: json_object`; the prompt still requests JSON and the backend still validates it. Malformed responses produce a recoverable error, not an unvalidated map. Local requests have a 120-second timeout. Model capability and speed depend on your hardware; compatibility does not establish medical reliability.

For text that stays on your hardware, use a genuinely local endpoint, a locally running model, and **typed notes**. A remote URL or a model server configured to forward requests changes that boundary. Voice-note transcription currently uses OpenAI; browser dictation may use a remote speech service.

## Use your own cloud API keys

Put keys in the ignored `.env` file on **your local server**. Never put them in browser code, a `VITE_` variable, the public website, a downloaded report, or GitHub. Restart the server after changing configuration.

```dotenv
# Choose the initial provider. Any configured provider also appears in the switcher.
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-5-mini

# Optional alternatives:
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=claude-haiku-4-5
XAI_API_KEY=your-key
XAI_MODEL=grok-4.20-0309-non-reasoning
```

Leave unused keys blank. The switcher shows only configured providers as selectable. A map keeps its provider in the UI for the duration of that activity. Cloud mapping sends the note, pinned coordinates and structure names, selected region, and follow-up answers only to the selected provider. The app does not send prompts to every provider or compare their responses in the background.

- **OpenAI:** Responses API with Pydantic structured outputs, `store=False`, output limit, timeout, and no automatic retries. [API documentation](https://developers.openai.com/api/docs/guides/structured-outputs).
- **Anthropic:** Messages API with the SDK’s schema transformation and Pydantic validation. [API documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
- **Grok:** xAI’s OpenAI-compatible Chat Completions API with a JSON schema and local validation. [Model documentation](https://docs.x.ai/developers/models/grok-4.20-non-reasoning).
- **Local:** OpenAI-compatible Chat Completions with validated JSON and no cloud fallback.

A ChatGPT or Claude chat subscription does not pay for API calls. Live cloud adapters require a funded API account. They have been tested with mocked provider responses; this repository does not contain a paid live-service test or a clinical validation.

### Voice notes and dictation

**Voice note** asks for microphone access, records up to 60 seconds, and converts audio in the browser to mono 16 kHz PCM WAV. The server validates actual format, byte count, and duration before sending it to OpenAI’s transcription endpoint. The transcript is editable before you submit the map. No recording is written to disk by the app. You need `OPENAI_API_KEY` for this feature, even if a different provider maps the text.

**Dictate** uses the browser’s speech-recognition feature when available. That service may transmit audio to a browser vendor. Browser support varies; typing always works. Microphone features require localhost or HTTPS. Local speech-to-text is not included in this version.

### Costs and limits

The public showcase makes **$0 in AI requests**. Static hosting and the domain are separate; the hosting provider’s plan applies. The source and demo mode have no fee. Local inference uses your hardware and electricity.

Illustrative cloud cost per exchange, assuming **2,000 input tokens and 1,000 output tokens**, at prices checked September 12, 2026:

| Default model | Input / output per million tokens | Example exchange |
| --- | --- | --- |
| GPT-5 mini | $0.25 / $2.00 | $0.0025 |
| Claude Haiku 4.5 | $1.00 / $5.00 | $0.0070 |
| Grok 4.20 non-reasoning, short context | $1.25 / $2.50 | $0.0050 |

Sources: [OpenAI](https://developers.openai.com/api/docs/models/gpt-5-mini), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [xAI](https://docs.x.ai/developers/pricing). Schema, instructions, repeated history, and reasoning can increase usage. These estimates are not spending limits. Transcription is billed separately; check [OpenAI’s transcription pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe) before enabling it.

The optional backend guard defaults to three new activities and three recordings per visitor/network per UTC day, six mapping calls per activity, and 12 requests per minute. Set the limits in `.env` for your own use. Switching providers, clearing cookies, or retrying does not reset the network allowance. Failed provider attempts count because they can still cost money.

Before each paid request, the server atomically reserves **$0.10 per mapping call** or **$0.03 per transcription** against a **$5.00 daily reservation budget**. Reservations persist across worker restarts and are retained after failure. This enforces the configured reservation total, **not the provider’s invoice**. The defaults are conservative for the pinned defaults and bounded inputs, not a price guarantee. Review reservation amounts when changing models or prices, and configure provider-account billing controls too. Demo/local inference does not reserve cloud budget.

## Anatomy navigation and exports

Use **Landmarks** to move from body → region → front/back/top/outer side → canonical muscle group. Shoulder landmarks include the deltoid and rotator-cuff muscles; neck landmarks include sternocleidomastoid, upper trapezius, levator scapulae, and splenius capitis. Inspecting a muscle hides surrounding muscles; **Show surrounding anatomy** restores them. Scroll toward the cursor to zoom, drag to orbit, and right-drag to pan. The buttons offer smooth camera transitions and keyboard-accessible region selection.

A click places a precise surface pin. The 3D overlay spreads heat around your pin; it does not infer tissue damage or a diagnosis. Coarse regions are approximate and can misclassify boundaries. The GLB meshes have finite detail: close zoom does not reveal microscopic anatomy. Detailed nerve pathways and motion analysis are outside this version.

- **SVG:** a standalone visual report with front/back projections, numbered pins, context, and clickable reading citations. Projection onto the report silhouette is approximate.
- **JSON:** `schema_version: 1`, the original note, timestamps, reported fields, answers, normalized 3D coordinates, named structures, provider label, and selected reference URLs. No API keys are included. Import/replay is not implemented yet.

## Curate the reading sources

Edit [`config/reading-library.json`](config/reading-library.json), then rebuild or restart the dev server. It holds a publisher list and individually curated reference entries. Each publisher has an ID, name, category, exact allowed hostnames, and a `recommended` default. Each reference has a title, publisher ID, HTTPS URL, region/activity tags, resource type, and date its link was checked.

The initial library includes NHS, AAOS/OrthoInfo, Mayo Clinic, APTA/ChoosePT, AOTA, UC Berkeley, Stanford's Human Performance Lab, and the NCAA Sport Science Institute. General clinical/PT/OT sources are selected by default; users can opt into the broader sports research and college-athletics sources. **Sources → Use recommended list** restores the curated default. No account or persistent preference storage is needed.

Only individually listed HTTPS links on the publisher's allowed hosts can appear. Sources match by region and activity, with related activity tags ranked first. Search and source filtering happen locally. The app does not send symptom text to a search engine, crawl arbitrary sites, or let an LLM invent reference URLs. A reference is related reading, not evidence that the user has the named condition or should perform its exercises. The source has not endorsed ihurt. `checked` records a link check, not a clinical review.

To add a college athletics program, open PT resource, or sports science lab, add its publisher and the specific pages you have reviewed. Prefer publicly readable original clinical/educational material. Preserve authorship, dates, precautions, and distinctions between research, general education, and individualized care. The test suite checks URL/host consistency and unique reference IDs. Publishers retain copyright; ihurt links to their pages rather than republishing their content.

## Privacy and limitations

- **No symptom storage:** notes, answers, and reports live in the browser tab’s memory; request content passes through the local API without being saved. Audio is held in memory for transcription. Session maps clear on refresh.
- **Minimal quota records:** SQLite stores random activity/request IDs, counters, and daily HMAC-hashed network addresses. It stores no raw IP addresses, symptom text, or recordings. Expired records are removed during later requests; this is logical deletion, not forensic disk erasure.
- **Provider policies apply:** anonymous symptom text is still health-related information. Omit identifying details. `store=False` disables OpenAI response storage but is not a promise of zero provider retention. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [Anthropic privacy](https://privacy.claude.com/), and [xAI privacy](https://x.ai/legal/privacy-policy).
- **Downloads are personal data:** JSON exports contain the original note; SVG reports contain the mapped description and symptoms. Keep them somewhere appropriate and choose carefully whom to share them with.
- **No tracking integrations:** ihurt adds no PostHog, session replay, analytics, account, or email collection. Your model server, reverse proxy, cloud provider, operating system, or static host may keep their own logs.
- **No medical validation:** keyword reminders can miss urgent symptoms or react to negated statements. Local and cloud models can invent or misplace information despite the prompt and schema. The app does not establish a cause or recommend treatment. Related reading does not establish a cause or a suitable treatment.

The local API binds to loopback. **Keep it local for the intended BYOK workflow.** If you independently expose it to visitors, production mode requires explicit HTTPS origins, hosts, a strong cookie secret, and server-verified Cloudflare Turnstile for enabled models. Turnstile has a [free plan](https://developers.cloudflare.com/turnstile/plans/). It is not used by the static showcase.

The API also has signed HTTP-only cookies, exact-origin checks, byte and field limits, server-controlled models/endpoints, per-activity ownership and concurrency checks, request deduplication, bounded output, and atomic SQLite quotas. It ignores forwarded client-IP headers in the default launch commands. Behind a proxy, trust only that proxy’s address and configure it to overwrite forwarding headers; otherwise all visitors share the proxy’s quota or untrusted headers can corrupt identity. One persistent SQLite database must be shared by all workers. It is not a distributed multi-host limiter. Anonymous session/IP quotas cannot reliably identify an individual, and shared networks can share an allowance.

## Development

```bash
npm run build       # app → dist/app
npm test           # backend and provider-contract tests; no paid API requests
npm run check      # app build and tests
```

To serve the built app from Python on one port:

```bash
npm run build
uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log
```

Open http://127.0.0.1:8000. The app is a React/TypeScript client. Three.js renders the detailed muscle and skeleton models with WebGL, using a self-hosted Draco WebAssembly decoder; a small AssemblyScript module compiled to WebAssembly computes the regional heat falloff. Graphics render on changes instead of continuously repainting an idle model. A schematic appears while about 11.5 MB of model files load progressively. If the atlas fails, that schematic remains available. If WASM fails, the heat computation has a JavaScript fallback; if WebGL fails, the app’s region picker and note flow remain available.

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

### Troubleshooting

- **API unavailable:** use `npm run dev`, not just `npm run dev:web`. The full command starts both services.
- **Provider is disabled:** fill its key or local model name in `.env` and restart the Python server. Keys never go in the UI.
- **Local mapping times out:** confirm the model server is running, the name matches its loaded model, and your hardware can run it. Choose a model that can follow a JSON schema.
- **An activity expired after a restart:** setup creates a stable session secret. If you skipped setup and left `SESSION_SECRET` blank, the development secret changes at startup. Keep a stable random secret in `.env` for quota sessions across restarts. Symptom notes still clear on page refresh.
- **Daily allowance reached:** the development guard is intentional; adjust `.env` for your own use. It resets at midnight UTC.
- **Microphone unavailable:** try localhost/HTTPS and check browser permissions. You can always type.

## License

ihurt's original source, schematic fallback, report silhouettes, and heat kernel are [MIT licensed](LICENSE). The bundled Z-Anatomy/BodyParts3D models have **separate Creative Commons attribution and share-alike requirements**. See the [full anatomy credits](public/models/ATTRIBUTION.md), [upstream notice](public/models/UPSTREAM-LICENSE.txt), and [file provenance](public/models/sources.json) before redistributing or modifying anatomy assets. The MIT license does not relicense them. The Draco decoder is Apache 2.0 licensed. Other dependencies retain their own licenses.
