# iOS implementation validation

Recorded on **2026-10-02** for the implementation following
[PR #13](https://github.com/sandbornm/ihurt/pull/13). The app builds and launches
in Simulator. Physical-device validation and distribution setup remain open.
Use this record with the [device checklist](IOS.md#camera-and-device-checks).

## Plan review

The plan correctly describes the existing Capacitor app. A native rewrite is
unnecessary for the specified notebook MVP. These corrections are included in
[the plan](IOS-APP-PLAN.md):

- Start Simulator work without an account. Initial physical-device testing can
  use a free Apple Account; paid membership belongs at the distribution step.
- Answer App Store privacy questions from actual data flows. The privacy
  manifest does not replace those answers or a public iOS privacy policy.
- Review anatomy redistribution terms before TestFlight distribution, as well
  as before the App Store submission.
- Treat the one-to-three-week estimate as conditional engineering time. It
  excludes enrollment and review waiting time and depends on hardware results.

## Implementation

- `npm run setup:ios` checks prerequisites, installs locked dependencies, runs
  `npm run check`, syncs the bundled app, and compiles an unsigned Debug build.
- `ios:build` accepts Debug or Release and an optional physical-device SDK.
  CI checks both simulator configurations and the unsigned physical-device
  Release build on relevant PRs and pushes to `main`. `Package.resolved` locks the
  native package graph, including the filesystem dependency.
- About includes the original anatomy, outer-body, Draco, and MIT notices as
  offline text, plus native storage, camera, speech, and export explanations.
  No license wording or anatomy coordinates changed.
- The local web API client rejects native calls before sending data, handles
  malformed responses, and retains web session, upload, cancellation, and quota
  behavior. Native dictation and exports continue through their adapters.

## Verification

Environment: Apple silicon Mac, Xcode **27.0 (27A266a)**, Swift **6.4**, and
the **iOS 27.0 (24A434)** simulator runtime. The deployment target remains
**iOS 16.4**; this run does not establish compatibility on that oldest OS.

| Check | Result | Scope |
| --- | --- | --- |
| `npm run setup:ios` | Passed | Dependency install, build, 97 TypeScript tests, 32 Python tests, Capacitor sync, Debug simulator compilation |
| `ios:build -- --configuration Release` | Passed | Optimized unsigned simulator build |
| `ios:build -- --configuration Release --device` | Passed | Unsigned physical-device SDK build; not an installable signed archive |
| iPhone 16 Pro simulator | Passed launch | Release app installed and launched; anatomy visibly rendered in Device Hub |
| iPad A16 simulator | Passed launch | Release app installed and launched; native interaction checks remain open |
| `test:ios-web` | Passed | Mocked native bridge at iPhone 16 Pro and iPad sizes; portrait/landscape, offline notices, persisted draft/entry, pin coordinates, all export formats, cancellation, failed writes |
| `test:ios-speech` | Passed | Mocked Apple Speech lifecycle, permissions, review, interruption, and cancellation |
| `test:voice` | Passed | Web voice adapter and review with synthetic audio and mocked responses |
| `test:browser` | Passed | Desktop/mobile notebook, edits, persistence, backup, offline anatomy; no API calls |

Browser screenshots are generated under `output/ios-check/` and the existing
browser/voice output directories. These files stay out of git. The checks use
the authorized example fixture or synthetic data. No paid provider calls were
made. The Python suite reports an existing Starlette/AnyIO deprecation warning.

## Remaining device and release checks

Use an **iPhone 16 Pro** first, then an iPad. Record the OS, app build, result,
and any issue for each check; leave a check open until it runs on hardware.

- Camera permission denial/recovery, front-camera aiming, complete gesture
  flow, background/resume, and the camera indicator after stopping.
- On-device dictation in airplane mode, language availability, permission
  recovery, final transcript, interruptions, one-minute limit, and coexistence
  with Hands. Simulator and mocks do not establish microphone behavior.
- Draft and saved-entry retention after force-quit and an in-place update.
- Actual Files import/export and share-sheet cancellation on iPhone and iPad,
  including JSON, `.ihm`, PNG, HTML, and notebook round trips.
- Both orientations, software keyboard, safe areas, VoiceOver, and larger text.
- Sustained frame rate, memory, battery, and device temperature. Check an older
  supported device/OS before claiming the full deployment range is validated.

Before TestFlight: select the signing team, reserve the final bundle ID, confirm
membership, review redistribution terms, prepare a public iOS privacy policy and
support URL, and produce a signed archive. No signing credentials, account
changes, TestFlight uploads, or App Store submissions were made in this work.

TestFlight recipients do not need paid developer membership; they install
TestFlight and accept an invitation. The publisher needs membership. See
[Apple's tester instructions](https://testflight.apple.com/) and
[developer account guide](https://developer.apple.com/help/account/basics/about-your-developer-account).
