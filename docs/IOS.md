# iHurt on iPhone and iPad

The iOS app packages the existing notebook in Capacitor's WKWebView. It includes
the anatomy models, fonts, WebAssembly, and MediaPipe hand model, so the notebook
does not need a server or internet connection. Gestures use the same TypeScript
controller as the web app. The first iOS build targets iOS 16.4 and later, matching the web build and bundled
SIMD WebAssembly ([WebKit 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)).

Capacitor supplies the local app origin, camera integration, and native file/share
plugins. This keeps the notebook and `.ihm` format shared instead of maintaining
a second UI or gesture implementation. Swift Package Manager manages iOS packages;
CocoaPods is not required.

## Build

Install Node 22.12 or later, uv, and [Xcode 26 or later](https://capacitorjs.com/docs/ios).
Apple Command Line Tools alone do not include the iOS SDK or Simulator.

```sh
npm ci
npm run check
npm run ios:sync
npm run ios:build
npm run ios:open
```

`ios:sync` rebuilds the app and copies it into the native project. Run it after web
changes. `ios:build` builds an unsigned simulator app. The checked-in project is
`ios/App/App.xcodeproj`; copied web assets and build outputs are ignored. Do not
run `cap add ios` again or replace the existing project.

In Xcode, choose the App scheme and an iPhone or iPad simulator, then Run. For a
physical device, select your Apple development team under Signing & Capabilities
and choose your connected device. Keep signing settings and credentials local.
The proposed bundle ID is `app.ihurt.notebook`; confirm availability before release.

The iOS CI job uses a standard GitHub-hosted macOS runner to compile the unsigned
simulator target. Expected cost: **$0 for this public repository**, under
[GitHub's public-repository Actions policy](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
That is an assumption about the repository remaining public, not a spending cap.
The workflow does not publish or submit the app.

Apple permits personal device testing with a free Apple Account, with provisioning
limits. App Store/TestFlight distribution requires the Apple Developer Program,
currently **US$99 per membership year**, or local pricing. No enrollment is needed
for the simulator. See [Apple's membership comparison](https://developer.apple.com/support/compare-memberships/).

## Keep entries and reports

The notebook uses the existing IndexedDB transactions in WKWebView's persistent
data store. Normal app relaunches and in-place updates retain entries and drafts.
The stable origin `capacitor://localhost` is part of that storage identity; changing
it requires a migration. This is local storage, not cloud sync or an uninstall
backup. Deleting the app deletes its notebook and its local report folder. The app
does not add its own encryption; device backup behavior follows the user's iOS settings.

To move an existing browser notebook:

1. In the browser, open **Notebook → Export notebook**.
2. Move the JSON file to your iPhone with Files, AirDrop, or another method you choose.
3. In the iOS app, open **Notebook → Import map** and select that JSON file.
4. Check the imported entries and pins before deleting the original copy.

The same export/import process moves entries back to the browser. Imports retain
the current validation, anatomy version checks, and conflict handling. Reimporting
an edited entry can create a separate entry; it does not merge changes across devices.

**Export JSON**, **Export notebook**, **Map image**, and the sharing controls save
a file in **Files → On My iPhone/iPad → iHurt → Reports**, then open the iOS share
sheet. Cancelling sharing keeps that file. Each export gets a new filename, so
earlier reports remain available. Delete unwanted exports in Files.

**Save / share report** produces a self-contained HTML report with the current body
view, notes, pins, reading links, and separate AI text when present. It can be
opened in a browser without iHurt. HTML is the first native report format; this
build does not claim native PDF generation. Use the web app's **Print / Save PDF**
when a PDF is needed. The saved HTML blocks scripts and remote asset loading.

The native app keeps **Share with AI** for deliberate file sharing. The optional
local Python AI server controls are hidden because the packaged app has no API
server. No server address, provider key, or cloud sync is added.

## Camera and device checks

The existing controller requests `facingMode: "user"`, a muted inline video, and
no microphone. iOS asks for camera permission when Hands is enabled. Frames are
processed locally; turning Hands off stops the tracks. WKWebView supports camera
capture with the app's permission declaration ([WebKit](https://webkit.org/blog/11353/mediarecorder-api/)).
MediaPipe uses the bundled model/WASM, tries GPU inference, and falls back to CPU.
Its video inference runs on the UI thread, so sustained performance needs real
device measurement ([MediaPipe](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker/web_js)).

Before calling the build ready for distribution, use a physical iPhone/iPad to:

- Deny camera permission, check the recovery message, then allow it in Settings and retry.
- Confirm front-camera selection, mirrored aiming, and the point-hold → pinch-dial → thumbs-up flow.
- Background and resume with Hands enabled; check that hidden frames stop being processed and a partial gesture cannot save after resuming. Turn Hands off and confirm the camera indicator disappears.
- Run several minutes of gestures while checking frame rate, responsiveness, battery use, and device heat. Test both orientations and the keyboard around the body controls.
- Save an entry and an unfinished draft, terminate the app, relaunch, and check both. Repeat after an in-place app update.
- Export JSON, `.ihm`, PNG, HTML, and a whole notebook. Cancel sharing once, check Files, and import the notebook into a fresh browser profile to compare notes, pin coordinates, intensity, and references.
- Launch in airplane mode. Verify the anatomy, reading, and hand model work without a first network visit.

`npm run test:ios-web` checks the UI's native export calls with a mocked Capacitor
bridge, including persistence across a page reload, cancelled sharing, and failed
writes. It does not validate UIKit, actual iOS storage, camera accuracy, or the
share sheet. The initial development machine had no Xcode or Simulator installed;
native compilation is delegated to CI and camera validation remains a device task.

## Code boundaries

- `src/platform/files.ts` is the framework-free export adapter used by Notebook.
- `src/platform/native.ts` connects the adapter to Capacitor and is imported only
  by the standalone `src/main.tsx` entry. The separate website can continue to
  consume Notebook without installing native dependencies.
- `ios/` holds the native project, camera permission, icon, and privacy manifest.
  `cap sync ios` maintains `CapApp-SPM/Package.swift`; keep custom configuration in
  the app project and `capacitor.config.ts`.

Keep the current export schema and anatomy coordinates shared across platforms.
Future durable database migrations or native camera inference should sit behind
these boundaries, with `.ihm` export/import kept compatible.
