# Simulator user-session profile

Recorded on 2026-10-03 in America/Chicago (artifacts use UTC), starting from
`main` at `5512ed3` (PR #14).
This pass uses the shipped notebook and an opt-in XCTest scenario. No profiling
hooks, logging, analytics, or debugger access are added to the app.

## Reproduce

Install the tools in [IOS.md](IOS.md), then run one device at a time:

```sh
npm run ios:sync
npm run profile:ios -- --device 'iPhone 16 Pro'
npm run profile:ios -- --device 'iPad (A16)'
```

The command builds **Release**, creates a fresh `iHurt test …` simulator, waits
for first-boot migration, and runs `testProfileNotebookSession`. It never uses
an existing notebook. Ordinary `test:ios-native` and CI select the shorter smoke
test instead. The profiling command records only its new simulator and removes
that simulator when the run finishes.

Each run creates an ignored `output/ios-profile/<device>-<timestamp>/` directory:

- `environment.json`: source revision, modified paths, host and toolchain details.
- `timings.json`: named actions with monotonic durations and wall-clock start
  times for locating the same interval in Instruments.
- `resources.json`: the renderer's cumulative CPU seconds and resident memory
  in KiB, sampled about once per second with `ps`. Phase CPU usage is the change
  in CPU seconds divided by elapsed sample time; 100% means one CPU core.
- `session.trace`: Instruments Time Profiler recording attached to the new
  simulator's WebContent renderer after launch sampling. It excludes the UIKit
  host and GPU service; it is not the app's total CPU or memory footprint.
- `session.mp4`: screen recording using the public example and synthetic input.
- `.xcresult` and `attachments/`: assertions, activity log, and screenshots.

Open the trace in Instruments and the test result in Xcode. Recordings and raw
traces stay out of git; publish only reviewed measurements and synthetic images.
The command makes no AI-provider calls. Camera and microphone input are excluded.

Summarize a completed run without opening Instruments:

```sh
node scripts/ios-profile-report.mjs output/ios-profile/<device>-<timestamp>
```

The report rejects failed runs. It uses only samples inside each named action,
reports their covered duration, and returns `null` when there are fewer than two
samples. Unsampled edges are excluded; short actions may have no CPU estimate.

## User scenario

1. Launch the app four times: first launch on a fresh install, then three
   process relaunches with retained app storage and potentially warm OS caches.
2. Leave the body map idle for 15 seconds.
3. Find **Neck**, open its layer picker, confirm **Pin this structure**, and enter the
   public fixture's neck comment and first sentence as a notebook observation.
4. Set a synthetic intensity with the slider, save, and reopen the entry three
   times. Verify the exact note, pin comment, and chosen rating each time.
5. Leave the reopened body map idle for another 15 seconds.
6. Export JSON, inspect the native share sheet, and cancel sharing.
7. Background for 10 seconds, resume, verify the note and removal of the privacy
   cover, then open and close the information dialog in landscape.

The fixture is [neck-tennis.json](examples/neck-tennis.json). Selecting Neck is an
explicit test action based on its written observation; it is not inferred from
tennis. The selected surface does not identify the cause of discomfort.

## How to interpret the measurements

XCTest action durations include scrolling, synthetic input, accessibility
queries, polling, and synchronization. They are **observed test durations**,
not app-only startup time or input latency. The first launch includes a fresh
app installation's WebKit startup. The three process relaunches are not three
independent cold boots. This small sample has no pass/fail performance budget.

The recording and profiler add overhead, and the simulator runs on the Mac's
CPU/GPU. Trace analysis targets the WebContent renderer identified through this
test simulator's launch services, rather than collecting every process on the
Mac. Measuring just the small UIKit host process would miss the notebook renderer.
Idle and background intervals are useful for
finding unexpected work; they are not battery estimates.
Resident memory is not the app's complete physical footprint, and growth during
a short session is not sufficient evidence of a leak. Renderer measurements
begin after the launch sequence; they do not cover startup allocation peaks.

Apple recommends physical-device profiling for higher-fidelity results:
[Improving your app's performance](https://developer.apple.com/documentation/xcode/improving-your-app-s-performance/).
This pass does not establish iPhone frame rate, camera or speech latency,
memory-pressure survival, thermal behavior, battery use, or iOS 16.4 support.

## Recorded findings

### Completed native sessions

One complete Release session passed on each device, with no skipped assertions.
Both verified exact note/comment/rating persistence across three entry reopens,
native JSON sharing and cancellation, background/resume, removal of the privacy
cover on resume, and the information dialog in landscape.

Local artifact directories under `output/ios-profile/`:

- iPhone 16 Pro: `iPhone-16-Pro-1791074061663` (151.1-second XCTest session).
- iPad A16: `iPad-A16--1791074368012` (146.9-second XCTest session).

Reviewed screenshots: [iPhone JSON sharing](images/ios-profile/iphone-json-share.png)
and [iPad landscape information](images/ios-profile/ipad-landscape-information.png).
The JSON preview contains only the authorized example and synthetic rating.
Full videos and traces remain in those local artifact directories, outside git.

### Measurements

CPU percentages below refer to **one Mac CPU core in the WebContent process**.
RSS is that process's resident memory on the Mac, including resident shared pages;
it is not iPhone/iPad physical footprint or the complete app/GPU memory cost.

| Observation | iPhone 16 Pro simulator | iPad A16 simulator |
| --- | ---: | ---: |
| First launch to body controls, XCTest elapsed | 14.47 s | 22.99 s |
| Three process relaunches, median (range), XCTest elapsed | 7.35 s (7.05–7.57) | 7.63 s (7.40–7.96) |
| Initial idle CPU (sample coverage within 15-second action) | 2.56% (14.04 s) | 2.30% (13.04 s) |
| Idle after reopening CPU (sample coverage within 15-second action) | 3.92% (14.02 s) | 2.85% (14.03 s) |
| Background action CPU, including transition (sample coverage) | 1.30% (10.01 s) | 1.81% (11.03 s) |
| Renderer RSS at end of first idle | 590.25 MiB | 414.25 MiB |
| Renderer RSS at end of reopens 1 / 2 / 3 | 827.02 / 893.06 / 1007.25 MiB | 760.98 / 852.97 / 949.86 MiB |
| Peak sampled renderer RSS | 1007.50 MiB | 949.86 MiB |
| Last sampled renderer RSS | 664.03 MiB | 645.70 MiB |
| Resource samples / total covered interval | 111 / 110.18 s | 96 / 95.21 s |

Idle activity was small compared with reopening: the reopen intervals consumed
about 1.5–1.6 renderer CPU seconds each. Memory rose across the three reopens,
then fell during later actions. That is a reason to investigate allocation
churn and retention, not sufficient evidence of a leak. Existing anatomy cleanup
already disposes geometries, materials, controls, and the renderer on unmount;
this pass does not identify a missing disposal call.

Launch figures include XCTest's launch handshake and three accessibility waits.
They must not be presented as app-only launch time or as evidence that physical
iPad hardware is slower. The one-session sample does not establish a performance
regression threshold.

Both Time Profiler files finalized and exported a `time-profile` table containing
only the intended WebContent process: **12,017 samples / 12.017 seconds of sample
weight** on iPhone and **9,689 / 9.689 seconds** on iPad. Sample weight is a
statistical estimate, distinct from the `ps` cumulative CPU measurements above.
The tool warned that one instrument table lacked a known input source. The CPU
tables were readable, but roughly **82% / 86%** of leaf sample weight had
address-only frame names. Do not infer individual JavaScript function costs,
frame rate, or absence of hangs from these partially symbolicated traces.

To inspect the same CPU table without opening Instruments:

```sh
xcrun xctrace export --input output/ios-profile/<run>/session.trace \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' \
  --output output/ios-profile/<run>/time-profile.xml
```

### Interaction findings and next work

1. **Measure memory on the physical iPhone before adding more native rendering.**
   Run a longer reopen sequence with Allocations/VM tracking and a device footprint
   measurement. Determine whether memory reaches a stable level and survives
   pressure. These measurements do not justify a Metal rewrite yet.
2. **Make keyboard and page navigation easier on iPhone.** The search keyboard
   covered the Neck result during a rehearsal; dismissing it with Done worked.
   After text entry, the page appeared enlarged and a drag at the screen edge
   could rotate the model instead of scrolling to Notebook. The accessibility
   snapshot reported a 459.5-point document inside a 402-point app view. Focus
   zoom is a plausible contributor because mobile fields use sizes below 16px,
   but this pass did not isolate the cause. Check focus zoom, input sizing,
   safe areas, and a reliable page-scroll margin while preserving user zoom.
   The completed replay uses the native status-bar tap to return to the tabs.
3. **Keep pin confirmation easy to reach.** Pin this structure was below the
   visible area of the independently scrolling layer picker on iPhone. The
   replay scrolls inside that panel. Consider a persistent confirmation footer
   while preserving the selected-surface explanation.
4. **Finish hardware coverage.** Camera/gesture inference, on-device dictation,
   physical-device memory, battery/thermal behavior, and the oldest supported OS
   remain on the [device checklist](IOS.md#camera-and-device-checks). No physical
   iPhone was visible to this Mac's device tools during this pass.

Harness rehearsals exposed platform differences: pressed web buttons can appear
as switches, the HTML range needed a touch drag, and iOS sharing exposed cells
in a popover. One rehearsal was interrupted after repeated 60-second XCTest
animation-notification waits during word-by-word keyboard input. The completed
profile enters each field in one operation and verifies the full value; ordinary
CI retains its word-by-word smoke test. Rehearsal failures and the interrupted
run are excluded from the measurement table. This is a reproducible scenario,
not a claim of repeated-run stability or full release readiness.

### Environment and regression checks

Host: Apple M4 Mac mini, 10 CPU cores, 16 GiB memory, arm64. Xcode **27.0
(27A266a)** and iOS **27.0 (24A434)**. Both device profiles use the same Mac;
differences between them do not compare physical iPhone and iPad hardware.
Fresh simulator setup can start substantial OS background work. No browser
test suite ran during a completed native profile.

| Check | Result in this pass |
| --- | --- |
| `npm run check` | Passed: build, 101 TypeScript tests, 32 Python tests |
| `npm run ios:sync` | Passed: rebuilt and copied the bundled app |
| `npm run profile:ios` · iPhone 16 Pro and iPad A16 | Passed: complete native Release sessions, recordings, scoped traces and resource samples |
| `npm run test:api-browser` | Passed: loopback Python server, demo map/session, HttpOnly cookie, no-store responses, bundled camera model/WASM, stopped tracks |
| `npm run test:ios-web` | Passed at iPhone and iPad sizes: native bridge mocks, offline notices, persistence, export formats, cancellation and failed writes |
| `npm run test:browser` | Passed at desktop and mobile sizes: notebook edits, refresh, backup, offline anatomy and storage |
| `npm run test:ios-speech` | Passed: mocked native recognition lifecycle, permissions, review, interruption and cancellation |
| `npm run test:voice` | Passed: web voice review, recovery, isolation, field preservation, cancellation, microphone cleanup and offline transcript |

All inputs are synthetic or from the authorized fixture. No paid provider calls
were made. The Python suite retains its existing Starlette/AnyIO deprecation
warning. The report arithmetic was checked with a synthetic two-second interval
(one CPU second = 50% of one core), missing samples, and failed-run rejection.
