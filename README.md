<img src="public/brand-mark.svg" width="64" height="64" alt="iHurt logo" />

# iHurt

Sit like a shrimp all day? Wake up sore from apparently nothing? Unsure where to start reading about stretches and movement?

iHurt helps you describe discomfort when words alone are hard to get right. Place pins on a 3D body, add what you notice during rest or activity, and build a **hurt map** with your chosen AI. Keep a visual record and explore references from sources you trust.

[![A neck and tennis case study: two pins, a note, and exercise references](docs/media/neck-tennis-case-study.gif)](docs/media/neck-tennis-case-study.mp4)

**A stiff neck after sleep and tennis.** This recorded example maps the left upper trap and high neck, including discomfort when looking down or turning left. [Watch the full walkthrough](docs/media/neck-tennis-case-study.mp4).

*Recorded in demo mode; no live AI response. Anatomy by Z-Anatomy and BodyParts3D — [credits and licenses](public/models/ATTRIBUTION.md).*

## Make your map

- Zoom into the anatomy and place up to six pins.
- Type a note, dictate, or record what you notice.
- Use a local model, OpenAI, Anthropic, or Grok to organize the record.
- Choose your reading sources and download an SVG or JSON report.

**[Install and run →](docs/SETUP.md)** · [Set up your AI](docs/PROVIDERS.md)

Notes clear on refresh, so download anything you want to keep. Cloud mapping sends your note and pins to the provider you choose. Voice transcription uses OpenAI; browser dictation may use a remote service. See [privacy and limitations](docs/SAFETY.md).

## Not medical advice

**iHurt is not medical advice whatsoever. It does not diagnose, treat, cure, mitigate, or prevent any disease, injury, or condition.** It is an experimental educational journal. Maps and reading links do not establish a cause or a personal treatment plan. Do not delay professional care based on its output. [Read the full limitations](docs/SAFETY.md).

## About the project

React, TypeScript, Three.js, and WebAssembly, with a Python backend. The static showcase for `ihurt.app` lives in a separate repository.

[Usage and source curation](docs/GUIDE.md) · [Development and tests](docs/DEVELOPMENT.md) · [MIT code license](LICENSE)
