# Medical limitations and privacy

[← ihurt](../README.md)

## Not medical advice

**ihurt is not medical advice whatsoever. It does not diagnose, treat, cure, mitigate, or prevent any disease, injury, or condition.** It is an experimental tool for education and personal reflection, not intended for use as a medical device, clinical assessment, or substitute for a qualified healthcare professional.

Do not use a hurt map to choose treatment, exercises, stretches, medication, or whether to seek care. The app does not prescribe any of these. Do not delay professional care because of its output. The model can misunderstand you, omit important details, or produce incorrect information.

The anatomy uses Z-Anatomy and BodyParts3D muscle and skeleton models, with approximate region boundaries. ihurt has not clinically validated the models, labels, pins, or heat overlays. Colors reflect **reported discomfort**, not tissue damage, a diagnosis, a nerve pathway, or disease probability. The app cannot determine whether pain is muscular, neurological, or caused by another condition.

If you have sudden chest pain, trouble breathing, new weakness, or loss of bladder or bowel control, seek emergency help. The app cannot assess emergencies; its keyword reminder is incomplete and can be wrong. See the [NHS guidance on back pain and warning signs](https://www.nhs.uk/conditions/back-pain/).

## Privacy and limitations

- **No symptom storage:** notes, answers, and reports live in the browser tab’s memory; request content passes through the local API without being saved. Audio is held in memory for transcription. Session maps clear on refresh.
- **Minimal quota records:** SQLite stores random activity/request IDs, counters, and daily HMAC-hashed network addresses. It stores no raw IP addresses, symptom text, or recordings. Expired records are removed during later requests; this is logical deletion, not forensic disk erasure.
- **Provider policies apply:** anonymous symptom text is still health-related information. Omit identifying details. `store=False` disables OpenAI response storage but is not a promise of zero provider retention. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [Anthropic privacy](https://privacy.claude.com/), and [xAI privacy](https://x.ai/legal/privacy-policy).
- **Downloads are personal data:** JSON exports contain the original note; SVG reports contain the mapped description and symptoms. Keep them somewhere appropriate and choose carefully whom to share them with.
- **No tracking integrations:** ihurt adds no PostHog, session replay, analytics, account, or email collection. Your model server, reverse proxy, cloud provider, operating system, or static host may keep their own logs.
- **No medical validation:** keyword reminders can miss urgent symptoms or react to negated statements. Local and cloud models can invent or misplace information despite the prompt and schema. The app does not establish a cause or recommend treatment. Related reading does not establish a cause or a suitable treatment.

The local API binds to loopback. **Keep it local for the intended BYOK workflow.** If you independently expose it to visitors, production mode requires explicit HTTPS origins, hosts, a strong cookie secret, and server-verified Cloudflare Turnstile for enabled models. Turnstile has a [free plan](https://developers.cloudflare.com/turnstile/plans/). It is not used by the static showcase.

The API also has signed HTTP-only cookies, exact-origin checks, byte and field limits, server-controlled models/endpoints, per-activity ownership and concurrency checks, request deduplication, bounded output, and atomic SQLite quotas. It ignores forwarded client-IP headers in the default launch commands. Behind a proxy, trust only that proxy’s address and configure it to overwrite forwarding headers; otherwise all visitors share the proxy’s quota or untrusted headers can corrupt identity. One persistent SQLite database must be shared by all workers. It is not a distributed multi-host limiter. Anonymous session/IP quotas cannot reliably identify an individual, and shared networks can share an allowance.
