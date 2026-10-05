# Run the latest iHurt on your own iPhone

Use the **Mac laptop that your iPhone is plugged into** for these steps. The Mac
mini's simulator and unsigned build cannot be downloaded directly onto a phone.
This builds the source on your laptop, then Xcode signs and installs it.

## Which code to download

As of 2026-10-04, the latest mobile improvements are in
[PR #16](https://github.com/sandbornm/ihurt/pull/16), on
**`codex/mobile-notebook-usability`**. Use that branch until it is merged;
`main` does not yet contain this PR. App and test changes through `11efa7d`
include the keyboard, touch scrolling, pin confirmation, and typing-test fixes.
The separate [profiling PR #15](https://github.com/sandbornm/ihurt/pull/15) is
not required to build or install the app.

## Prepare the laptop

Install these on the laptop even if they are already installed on the Mac mini:

- **Full Xcode 26 or later**, with support for your phone's iOS version. Open it
  once and finish its required-component installation. Command Line Tools alone
  are insufficient. Use a newer Xcode if your phone runs a newer iOS version.
- [Node.js](https://nodejs.org/en/download) **22.12 or later** and Git.
- [uv](https://docs.astral.sh/uv/getting-started/installation/), used to prepare
  bundled assets and run the Python checks. It can install Python if needed.

Check the tools in Terminal:

```sh
xcodebuild -version
node --version
uv --version
```

If `xcodebuild` says the active developer directory is Command Line Tools,
select the installed Xcode under **Xcode → Settings → Locations → Command Line
Tools**, then retry. A Simulator runtime is needed to run simulator tests;
installing on your real phone uses the device SDK and signing instead.

## Download and build

For a new checkout, run this from the folder where you keep projects:

```sh
git clone --branch codex/mobile-notebook-usability https://github.com/sandbornm/ihurt.git
cd ihurt
npm run setup:ios
npm run ios:open
```

`setup:ios` installs the locked dependencies, runs the build and unit/backend
checks, copies the web assets into the native project, and checks an unsigned
simulator build. Initial setup needs internet access. It does not need an AI
account, provider keys, or a running API server. CocoaPods is not used.

If you already have a checkout, first inspect `git status --short` and preserve
any local work. With a clean checkout, update it with:

```sh
git fetch origin
git switch codex/mobile-notebook-usability
git pull --ff-only
npm run setup:ios
npm run ios:open
```

If the PR branch has been merged and deleted, use the updated `main` branch.
For subsequent source edits, run `npm run ios:sync` before running the app in
Xcode; it rebuilds and recopies the assets. Signing configuration stays local.

## Install on the connected iPhone

1. Connect the phone to the **laptop**, unlock it, and accept **Trust This
   Computer**. Keep it unlocked during initial setup.
2. In **Xcode → Settings → Accounts**, sign in with your development Apple
   Account. This does not require changing the iCloud account on the phone.
3. Close Settings. Press **Command–1** to show the project navigator. Select the
   blue **App** project, then **TARGETS → App → Signing & Capabilities**.
4. Enable **Automatically manage signing** and select your **Team**. The project
   is `ios/App/App.xcodeproj`; the scheme and target are both **App**; the bundle
   identifier is **`app.ihurt.notebook`**. Resolve team/account errors before
   changing that identifier.
5. Select **your actual iPhone's name** in Xcode's top toolbar, next to the App
   scheme. Press **Command–R** or click the Run triangle.
6. If requested, enable **Settings → Privacy & Security → Developer Mode** on
   the phone, restart, and confirm. Press **Command–R** again. Follow any
   device-specific trust instructions Xcode displays.

Once iHurt opens successfully, unplug the phone and launch it from its Home
Screen. Use **Run**, not **Test**, for this installation. The automated native
test suite intentionally uses disposable simulators and refuses ordinary
device destinations. See [Apple's device-running guide](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).

A free Personal Team supports local testing while organization enrollment is
pending; it requires reinstalling/reprovisioning after seven days. An active
paid membership supports development signing and TestFlight distribution. A
D-U-N-S number is not required for personal device testing.
See [Apple's account and provisioning limits](https://developer.apple.com/help/account/basics/about-your-developer-account).
This workflow does not create a TestFlight download link.

The notebook works without the laptop or an API server after installation.
Keep the existing app installed when updating through Xcode. Deleting it deletes
its local notebook. Browser and native notebooks do not sync automatically;
use **Notebook → Export notebook**, then import the JSON on the other device.
See [the iOS storage and export guide](IOS.md#keep-entries-and-reports).

## Context to paste into Codex on the laptop

```text
Help me build and install iHurt on my real iPhone connected to this Mac laptop.
Repository: https://github.com/sandbornm/ihurt
Latest mobile work: PR #16, branch codex/mobile-notebook-usability.
Use that branch while the PR is open; use updated main if it has been merged.

Read AGENTS.md, docs/IOS-LAPTOP-HANDOFF.md, and docs/IOS.md. Inspect any existing
checkout and preserve local work. Check full Xcode (26+ and compatible with my
phone), Node 22.12+, and uv. Run npm run setup:ios, then npm run ios:open.
The project is ios/App/App.xcodeproj, target/scheme App, bundle ID
app.ihurt.notebook. Help me select my development Team and my physical phone,
then build and install with Run. I will handle Apple sign-in, Trust, and
Developer Mode prompts. Keep team-specific signing changes local.

The app works offline with local journal storage; no AI keys or API server are
needed. Preserve the installed notebook during updates. Use disposable
simulators for automated tests. Check PR #16's current CI status rather than
assuming older failure logs describe the latest code.
```

Local iPhone 16 Pro and iPad A16 checks passed for the final phrase-based typing
scenario. The [mobile report](IOS-MOBILE-USABILITY.md) records the earlier test
failures and their fixes. GitHub Actions checks are linked from the PR; consult
the current commit's results. Camera, speech quality, memory, and battery use
still require physical-device testing.
