# iOS app assessment and execution plan

**Date:** 2026-10-02 · **Repo:** [sandbornm/ihurt](https://github.com/sandbornm/ihurt) · **Audience:** development planning

This document assesses the current iHurt stack, estimates lift for a first shippable iOS app, and lays out a phased plan. Build and device details live in [IOS.md](IOS.md); this file is the roadmap.

---

## 1. Current stack (what it is today)

iHurt is already a **hybrid** product, not a greenfield native rewrite.

| Layer | Technology | Role |
| --- | --- | --- |
| Web / notebook UI | React 19, TypeScript, Vite 7 | Pins, journal, intensity, reading, sharing UI |
| 3D / graphics | Three.js, Draco WASM, AssemblyScript heat WASM | Anatomy viewer (~11.5 MB GLB models) |
| Hands | MediaPipe Tasks Vision (bundled WASM + model) | Front-camera gesture pin / dial / save |
| Local storage | IndexedDB (shared web + WKWebView) | Entries, drafts; no cloud sync |
| Optional AI | FastAPI (Python/uv) + provider adapters | Local BYOK; **hidden on iOS** |
| Voice (web) | ElevenLabs via local Python API | Optional; not required for typed drafts |
| Voice (iOS) | Apple Speech + microphone (on-device only) | Native Capacitor plugin |
| Packaging | Capacitor 8 (`app.ihurt.notebook`) | Offline WKWebView shell |
| Native iOS | Xcode project under `ios/App`, SPM | Filesystem + Share plugins, AppleSpeech, privacy plist |
| CI | `.github/workflows/ios.yml` on `macos-15` | Unsigned simulator build after `ios:sync` |
| Companion site | Private `ihurt-site` → ihurt.app | Showcase /try/; separate from this repo |

**Already merged (PRs #7–#8 and follow-ups):**

- Offline Capacitor shell with models, fonts, WASM, MediaPipe bundled
- Native report export to Files + share sheet (JSON, `.ihm`, PNG, HTML)
- Platform adapters (`src/platform/files.ts`, `native.ts`, `apple-speech.ts`) so the website can stay Capacitor-free
- On-device Apple dictation for voice drafts (no server fallback)
- Mocked Capacitor browser checks (`test:ios-web`, `test:ios-speech`) plus unsigned CI compile
- Device checklist and medical/privacy constraints documented in [IOS.md](IOS.md) and [SAFETY.md](SAFETY.md)

**Version markers:** marketing `0.1.0`, build `1`, deployment target **iOS 16.4+**, proposed bundle ID `app.ihurt.notebook` (availability not yet confirmed for App Store).

---

## 2. Lift estimate for a first iOS app (MVP)

### MVP scope (recommended)

Ship a **TestFlight / App Store “notebook”** that matches what the Capacitor shell already claims:

1. Offline anatomy notebook (pin, note, intensity, multi-entry journal)
2. Import / export notebook JSON and `.ihm` via Files + share sheet
3. HTML / PNG / JSON report save-and-share (PDF remains web Print for v1)
4. Optional Hands camera gestures with clear permission recovery
5. Optional on-device Apple dictation for drafts
6. Strong “not medical advice” copy, offline credits, and App Store privacy answers based on actual data flows; review [PrivacyInfo.xcprivacy](../ios/App/App/PrivacyInfo.xcprivacy) separately for required-reason APIs and SDK declarations
7. No accounts, no analytics SDK, no in-app AI server, no cloud sync

**Explicitly out of MVP:** SwiftUI rewrite, native Metal renderer, cloud backup, in-app subscriptions, native PDF, Android, App Clip, HealthKit, Clinical / FDA pathway.

### Lift rating

| Area | Lift | Notes |
| --- | --- | --- |
| Product code for MVP features | **Low** | Shell + adapters already on `main` |
| Physical device validation | **Medium** | Camera, speech, heat/perf, battery — not covered by CI |
| Signing, bundle ID, Developer Program | **Medium** | Process + $99/year; local credentials only |
| App Store listing + review | **Medium–High** | Health-adjacent copy; disclaimers; CC anatomy attribution |
| Anatomy license compliance | **Medium** | Z-Anatomy / BodyParts3D CC terms on redistribution |
| Performance hardening | **Medium** | ~12 MB models + MediaPipe on older phones |
| True native rewrite | **Very high** | Not needed for MVP; avoid |

**Overall MVP lift: medium.** The feature baseline is implemented. The **1–3 focused weeks** estimate is a planning range for engineering and submission preparation, conditional on device results; it excludes enrollment and App Review waiting time. Compilation and mocked browser checks do not establish hardware readiness. Paid membership is needed for distribution, not to start implementation or Simulator testing.

### Key risks and dependencies

- **Device/perf unknown:** MediaPipe runs on the UI thread; sustained gesture sessions need real iPhone measurement ([IOS.md](IOS.md) checklist).
- **Storage identity:** IndexedDB is tied to `capacitor://localhost`. Changing scheme/hostname without migration loses journals.
- **No uninstall backup:** deleting the app deletes the notebook; export/import is the migration story.
- **App Review / medical framing:** must stay educational journal, not diagnosis/treatment. Review notes should cite SAFETY.md language.
- **Bundle ID:** `app.ihurt.notebook` must be reserved/confirmed before release builds.
- **Xcode 26+** required by current `ios-build.mjs` and Capacitor 8 guidance; CI pins `Xcode_26.3`.
- **CC anatomy assets:** App Store binary redistributes GLBs; keep ATTRIBUTION visible and license-compatible.
- **macOS/Xcode dependency:** Linux agents can only land docs and web/TS changes; native compile and Simulator require Apple hardware (or the existing macOS CI job).

### Dependencies checklist

- [ ] Apple Developer Program membership (US$99/year) for TestFlight / App Store
- [ ] Mac with Xcode 26+ for local device runs (CI covers unsigned simulator only)
- [ ] Physical iPhone and/or iPad on iOS 16.4+
- [ ] Confirmed bundle ID and signing team (kept local; never committed)
- [ ] App Store screenshots, privacy answers, support URL, age rating
- [ ] Review of anatomy attribution for store listing / in-app About

Initial target: **iPhone 16 Pro**, starting in Simulator. Keep iPad support and
check portrait, landscape, keyboard, and share-sheet presentation there too.
Physical camera, dictation, heat, and battery checks remain release gates.

---

## 3. Phased execution plan

### Phase 0 — Baseline (done on `main`)

- Capacitor iOS project, sync/build scripts, CI simulator job
- Native Files + Share exports; AppleSpeech plugin
- Docs: [IOS.md](IOS.md), this plan

**Exit:** unsigned simulator build green on CI; mocked web checks green.

### Phase 1 — Device MVP validation (next)

**Order of work:**

1. Install Xcode's required components and an iOS Simulator runtime. Run the iPhone 16 Pro simulator first, then an iPad. No Apple account is needed for unsigned Simulator builds.
2. `npm ci && npm run check && npm run ios:sync && npm run ios:open` on a Mac. For physical testing, sign in to an Apple Account in Xcode and enable Developer Mode on the device. A free Personal Team can start device testing, subject to [Apple's provisioning limits](https://developer.apple.com/help/account/basics/about-your-developer-account). Keep signing changes local.
3. Execute the full [IOS.md device checklist](IOS.md#camera-and-device-checks): camera deny/allow, Hands flow, background/resume, airplane mode, export/import round-trip, dictation permissions and coexistence with Hands.
4. Record perf notes (frame rate, heat, battery) on at least one recent and one older supported device.
5. Fix only blockers found (permission copy, audio session, memory, UI safe areas). Keep shared TS/gesture code; prefer adapter-side fixes.

**Exit:** checklist signed off on hardware; known issues listed or fixed.

### Phase 2 — Release plumbing

1. Confirm Apple Developer Program membership and reserve the final bundle ID. Review anatomy redistribution terms before distributing any TestFlight binary. Bump marketing/build numbers deliberately for candidates.
2. Archive a signed Release build; upload to App Store Connect / TestFlight.
3. Answer [App Store privacy questions](https://developer.apple.com/app-store/app-privacy-details/) from actual app and SDK behavior, including user-initiated sharing and feedback. A privacy manifest is not the questionnaire or a public privacy policy. Review both separately and provide a public policy URL that describes the iOS app.
4. Prepare store listing: screenshots (iPhone + iPad if supporting both), subtitle, keywords, support/privacy URLs, age rating.
5. Attach App Review notes: educational journal, not a medical device; quote SAFETY disclaimers; explain camera (gestures) and speech (on-device drafts only).
6. Internal TestFlight → small external group → iterate on crash/perf feedback.

**Exit:** TestFlight build used by real testers without critical data loss or camera/speech regressions.

### Phase 3 — App Store MVP submit

1. Resolve TestFlight issues; freeze MVP feature set (no late AI-server work).
2. Confirm attribution / license text reachable from About or docs linked in the listing.
3. Submit for review; monitor for health-claim or permission-string questions.
4. Tag a release in git (e.g. `ios-0.1.0`) matching the marketed version after approval.

**Exit:** first public or unlisted App Store version live, or a documented review rejection with a fix plan.

### Phase 4 — Post-MVP (optional, prioritized)

Only after Phase 3:

| Priority | Item | Why later |
| --- | --- | --- |
| P1 | Native PDF (or better print path) | Web Print covers early users |
| P1 | Durable storage migration story if origin ever changes | Avoid journal loss |
| P2 | Perf: reduce model payload / lazy layers / gesture thread | Needs Phase 1 measurements |
| P2 | Optional iCloud or explicit backup UX | Product decision; privacy-sensitive |
| P3 | HealthKit / widgets / App Clip | Out of journal scope |
| P3 | SwiftUI or native 3D rewrite | Duplicates working hybrid stack |
| P3 | In-app cloud AI | Conflicts with offline-first + key-on-server model |

### Suggested milestone order (summary)

```text
Phase 0  already on main          → CI shell + docs
Phase 1  device validation        → Mac + physical iPhone checklist
Phase 2  TestFlight               → signing, listing draft, beta
Phase 3  App Store MVP            → review + tag
Phase 4  post-MVP hardening       → PDF, perf, backup UX as needed
```

### Working agreements (keep)

- Prefer documentation and adapter changes over rewriting Notebook / Three.js for iOS.
- Do not re-run `cap add ios` or replace `ios/App/App.xcodeproj`.
- Keep provider keys and signing credentials off the repo.
- Preserve medical limitation wording; do not imply diagnosis or treatment.
- Linux/cloud agents: ship docs and shared TS; leave Xcode archive/upload to a Mac.

---

## 4. Quick reference commands

```sh
npm ci
npm run check
npm run ios:sync          # rebuild web → copy into ios/
npm run ios:build         # unsigned simulator (needs Xcode 26+)
npm run ios:open          # open in Xcode
npm run test:ios-web      # mocked Capacitor export bridge
npm run test:ios-speech   # mocked Apple speech bridge
```

See [IOS.md](IOS.md) for storage behavior, speech boundaries, and the pre-distribution device checklist.
