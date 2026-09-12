# AI providers and voice input

[← ihurt](../README.md)

## Start with Grok

After setup, open `.env` in the project folder and set:

```dotenv
LLM_PROVIDER=grok
XAI_API_KEY=your-xai-api-key
```

Keep the key in this ignored local file. Restart `npm run dev` after saving. The default model is `grok-4.20-0309-non-reasoning`; override `XAI_MODEL` if needed. The app shows Grok as the selected provider and asks for consent before sending your note. An exchange with 2,000 input and 1,000 output tokens costs an estimated $0.005; see the cost table below. API calls are billed to your xAI account.

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

Other OpenAI-compatible servers use the same settings. Set `LOCAL_API_KEY` if your server requires a token. Set `LOCAL_JSON_MODE=false` only if it rejects `response_format: json_object`; the prompt still requests JSON and the backend still validates it. If the response fails validation, the app shows an error and lets you retry. Local requests have a 120-second timeout. Speed depends on the model and your hardware. A compatible model has not necessarily been tested for medical reliability.

To keep text on your hardware, use a model running locally and **typed notes**. A remote endpoint or a server that forwards requests can send your text elsewhere. Voice-note transcription currently uses OpenAI; browser dictation may use a remote speech service.

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

Leave unused keys blank. You can select any configured provider. A map keeps the provider you started with. Cloud mapping sends the note, pinned coordinates and structure names, selected region, and follow-up answers only to the selected provider. It makes no background requests to other providers.

- **OpenAI:** Responses API with Pydantic structured outputs, `store=False`, output limit, timeout, and no automatic retries. [API documentation](https://developers.openai.com/api/docs/guides/structured-outputs).
- **Anthropic:** Messages API with the SDK’s schema transformation and Pydantic validation. [API documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
- **Grok:** xAI’s OpenAI-compatible Chat Completions API with a JSON schema and local validation. [Model documentation](https://docs.x.ai/developers/models/grok-4.20-non-reasoning).
- **Local:** OpenAI-compatible Chat Completions with validated JSON and no cloud fallback.

A ChatGPT or Claude chat subscription does not pay for API calls. Live cloud adapters require a funded API account. Tests use mocked provider responses. They do not verify a live paid account or establish clinical validity.

### Voice notes and dictation

**Voice note** asks for microphone access, records up to 60 seconds, and converts audio in the browser to mono 16 kHz PCM WAV. The server validates actual format, byte count, and duration before sending it to OpenAI’s transcription endpoint. The transcript is editable before you submit the map. No recording is written to disk by the app. You need `OPENAI_API_KEY` for this feature, even if a different provider maps the text.

**Dictate** uses the browser’s speech-recognition feature when available. That service may transmit audio to a browser vendor. Browser support varies; typing always works. Microphone features require localhost or HTTPS. Local speech-to-text is not included in this version.

### Costs and limits

The public showcase makes no AI requests, so its AI cost is **$0**. Static hosting and the domain are separate; the hosting provider’s plan applies. The source and demo mode have no fee. Local inference uses your hardware and electricity.

Illustrative cloud cost per exchange, assuming **2,000 input tokens and 1,000 output tokens**, at prices checked September 12, 2026:

| Default model | Input / output per million tokens | Example exchange |
| --- | --- | --- |
| GPT-5 mini | $0.25 / $2.00 | $0.0025 |
| Claude Haiku 4.5 | $1.00 / $5.00 | $0.0070 |
| Grok 4.20 non-reasoning, short context | $1.25 / $2.50 | $0.0050 |

Sources: [OpenAI](https://developers.openai.com/api/docs/models/gpt-5-mini), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [xAI](https://docs.x.ai/developers/pricing). Schema, instructions, repeated history, and reasoning can increase usage. These estimates are not spending limits. Transcription is billed separately; check [OpenAI’s transcription pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe) before enabling it.

The optional backend guard defaults to three new activities and three recordings per visitor/network per UTC day, six mapping calls per activity, and 12 requests per minute. Set the limits in `.env` for your own use. Switching providers, clearing cookies, or retrying does not reset the network allowance. Failed provider attempts count because they can still cost money.

Before each paid request, the server atomically reserves **$0.10 per mapping call** or **$0.03 per transcription** against a **$5.00 daily reservation budget**. Reservations persist across worker restarts and are retained after failure. This enforces the configured reservation total, **not the provider’s invoice**. The reservations allow for the default models and input limits; they do not guarantee a price. Review reservation amounts when changing models or prices, and configure provider-account billing controls too. Demo/local inference does not reserve cloud budget.
