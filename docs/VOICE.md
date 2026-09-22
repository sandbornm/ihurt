# Voice drafts

Use **Use voice** beside the note field. Review the transcript and the suggested
fields, then choose **Add to entry**. Existing fields are left unchecked so a new
recording does not overwrite them by default. The transcript appends to your note.
Save the entry when you are ready.

Suggestions use explicit phrases such as “four out of ten,” “Activity: running,”
and “Duration: since yesterday.” They do not diagnose symptoms or guess a muscle
from an activity. A named area can focus the body view; choose the surface yourself
to create a pin. You can type or paste a transcript without any provider.

## Web and local server

First [install the app](SETUP.md#install-locally) and
[uv](https://docs.astral.sh/uv/getting-started/installation/). From the repository
root, run:

```bash
npm run setup:ai
```

This installs the locked Python dependencies with `uv` and creates a private
`.env` with a generated session secret. It preserves an existing `.env`.
The same server handles voice; another AI provider is optional.

Open `.env` in your editor and set:

```dotenv
TRANSCRIPTION_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=
LLM_PROVIDER=demo
```

Paste your key after `ELEVENLABS_API_KEY=`. If your `.env` predates voice support,
add the two transcription settings. Keep your existing `LLM_PROVIDER` if you
already use an integrated AI provider.

Create a restricted ElevenLabs key with **Speech to Text** access only and a
small custom credit quota. Leave unrelated permissions disabled. Use separate
development and production keys. Never put a
key in a `VITE_` variable, browser code, a recording, or Git. IP restrictions are
useful only when the server has a known, stable outbound address.

Run `npm run dev:ai`, then open **http://127.0.0.1:5173**. Restart that command
after changing `.env`. The notebook remains usable without this server.
Set `TRANSCRIPTION_PROVIDER=off` to disable uploads.
Existing OpenAI transcription is an explicit opt-in with
`TRANSCRIPTION_PROVIDER=openai` and a server-side `OPENAI_API_KEY`.

Recordings stop after 60 seconds. Stopping or reaching that limit sends the audio
through the server to the selected provider. Cancel before stopping to discard
the recording without uploading it. After upload starts, discarding the result
cannot retract audio the provider has already received.
The server validates a mono, 16-bit, 16 kHz WAV and strips metadata before sending
it. Audio stays in memory for the request; provider retention rules still apply.
There is no claim of zero retention at ElevenLabs.

### Check the configuration

With the server running, this reads local configuration without recording audio
or calling ElevenLabs:

```bash
curl --fail http://127.0.0.1:8000/api/session
```

Expect `"transcription_available": true` and
`"transcription_provider": "ElevenLabs"`. This confirms the server loaded a key;
it does not verify the key's validity, permissions, or credit balance.
Open **Use voice** and type a transcript to try review and field selection for
free. A real recording sends audio to the provider and may incur charges.

If recording is unavailable, check the two transcription settings and restart
`npm run dev:ai`. `npm run dev` alone starts only the web UI. If a recording fails,
check microphone permission, the key's Speech to Text access and expiry, and the
available provider credits. Provider errors are intentionally hidden from the UI.
Do not paste keys or recordings into bug reports.

### Cost and hosted use

ElevenLabs lists Scribe at $0.22 per audio hour, about $0.0037 per minute, before
plan differences and billing rounding. This estimate is not a spending limit.
Credit quotas and the existing visitor/global request limits provide separate
controls. See [pricing](https://elevenlabs.io/pricing/api) and
[restricted keys](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys).

The private `ihurt-site` repository has separate Worker configuration and hosted
setup instructions in `docs/VOICE.md`. Its `VOICE_ENABLED` switch defaults to
`false`; local `.env` settings do not configure the website. Do not expose this
local Python server to the internet.

## Keeping a draft

Closing the voice panel or pressing Escape keeps the reviewed text, field choices,
and selected area in memory. Reopen **Review voice draft** to continue, or use
**Discard draft** to clear it. Adding the draft clears that review and saves its
text with the entry. Leaving the entry view, switching entries, or reloading clears
an unapplied review; audio is never kept for reopening. Closing during recording
or upload cancels that attempt and preserves the text from before it started.

## iOS

The native adapter uses Apple speech when the device and language support
on-device recognition. The first recording asks for microphone and speech
permissions. Unsupported devices can still accept a typed transcript. The app
does not fall back to a remote provider. See [iOS setup](IOS.md) for device testing.

## Checks

`npm run check` validates the provider and conservative draft parser.
`npm run test:voice` uses synthetic microphone audio and mocked provider responses
to check review, cancellation, cleanup, and preservation of existing fields.
These tests make no paid API calls. Test native permissions and speech on a real
iPhone before release.
