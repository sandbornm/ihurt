import XCTest

@MainActor
final class NotebookUITests: XCTestCase {
    private func typeVerified(_ text: String, into editor: XCUIElement) {
        var typed = ""
        for word in text.split(separator: " ") {
            let chunk = (typed.isEmpty ? "" : " ") + word
            editor.typeText(chunk)
            typed += chunk
            XCTAssertEqual(editor.value as? String, typed, "Typing must finish before the persistence check.")
        }
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, scrollUp: Bool = true) {
        for _ in 0..<14 {
            if element.exists && element.isHittable { return }
            // Use the page gutter so dragging does not turn the 3D body instead.
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: scrollUp ? 0.8 : 0.3))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: scrollUp ? 0.3 : 0.8))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(element.isHittable, "Control should be reachable by scrolling: \(element)")
    }

    func testNotebookSurvivesRelaunchAndBackground() throws {
        continueAfterFailure = false
        XCTAssertTrue(
            ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("iHurt test ") == true,
            "Run npm run test:ios-native. These tests may only edit a disposable iHurt test simulator."
        )
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()

        XCTAssertTrue(app.buttons["New entry"].waitForExistence(timeout: 90))
        XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 30))
        // WebKit exposes aria-pressed controls as switches on some iOS versions.
        XCTAssertTrue(app.descendants(matching: .any)["Pin"].waitForExistence(timeout: 90))

        let about = app.buttons["Privacy & limitations"]
        reveal(about, in: app)
        about.tap()
        XCTAssertTrue(app.staticTexts["Your notebook, your data"].waitForExistence(timeout: 10))
        app.buttons["Close information"].tap()

        // These words come from the authorized public example, never a user's notebook.
        let note = "My left upper trap and high left neck feel stiff after sleeping on my side and stomach."
        let editor = app.textViews["Describe your discomfort"]
        reveal(editor, in: app, scrollUp: false)
        editor.tap()
        // Long synthesized key bursts can lose events on a busy hosted simulator.
        // Verify each word before testing whether the app persists the edit.
        typeVerified(note, into: editor)
        XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["New entry"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any)["Pin"].waitForExistence(timeout: 90))
        reveal(editor, in: app)
        XCTAssertEqual(editor.value as? String, note)

        let save = app.buttons["Save entry"]
        reveal(save, in: app)
        save.tap()
        XCTAssertTrue(app.staticTexts["Entry saved on this device."].waitForExistence(timeout: 15))
        let notebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Notebook")).firstMatch
        reveal(notebook, in: app, scrollUp: false)
        notebook.tap()
        let open = app.buttons["Open entry"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        reveal(open, in: app)
        open.tap()
        reveal(editor, in: app)
        XCTAssertEqual(editor.value as? String, note)

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        app.activate()
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        XCTAssertFalse(app.otherElements["notebook-privacy-cover"].exists)
        XCTAssertEqual(editor.value as? String, note)

        XCUIDevice.shared.orientation = .landscapeLeft
        reveal(about, in: app)
        about.tap()
        XCTAssertTrue(app.buttons["Close information"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Landscape information"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["Close information"].tap()
    }

    // Opt in with npm run profile:ios. Regular CI selects the smoke test above.
    func testProfileNotebookSession() throws {
        continueAfterFailure = false
        XCTAssertTrue(
            ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("iHurt test ") == true,
            "Profiling may only edit a fresh disposable iHurt test simulator."
        )
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        var samples: [[String: Any]] = []
        func step(_ name: String, _ action: () -> Void) {
            XCTContext.runActivity(named: name) { _ in
                let start = ProcessInfo.processInfo.systemUptime
                let date = Date().timeIntervalSince1970 * 1000
                action()
                samples.append([
                    "name": name,
                    "startUnixMs": date,
                    "durationMs": (ProcessInfo.processInfo.systemUptime - start) * 1000
                ])
            }
        }
        func ready() {
            XCTAssertTrue(app.buttons["New entry"].waitForExistence(timeout: 90))
            XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 30))
            XCTAssertTrue(app.descendants(matching: .any)["Pin"].waitForExistence(timeout: 90))
        }
        func screenshot(_ name: String) {
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        defer {
            let report: [String: Any] = [
                "schemaVersion": 1,
                "measurement": "XCTest-observed wall time; includes automation, synchronization and accessibility polling. Not device TTI or input latency.",
                "samples": samples
            ]
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "Simulator profile timings"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
            XCUIDevice.shared.orientation = .portrait
        }

        for launch in 0..<4 {
            if launch > 0 { app.terminate() }
            step(launch == 0 ? "first_launch_to_body_controls" : "process_relaunch_\(launch)_to_body_controls") {
                app.launch()
                ready()
            }
        }
        print("IHURT_PROFILE_READY")
        step("idle_body_15s") { Thread.sleep(forTimeInterval: 15) }
        step("find_neck") {
            let find = app.buttons["Find a region"]
            reveal(find, in: app)
            find.tap()
            let search = app.textFields["Search body regions"]
            XCTAssertTrue(search.waitForExistence(timeout: 10))
            search.tap()
            search.typeText("neck")
            // The iPhone form accessory can cover the result while typing.
            let done = app.buttons["Done"]
            if done.exists { done.tap() }
            app.buttons["Neck"].tap()
            XCTAssertTrue(app.buttons["Add pin in selected region"].waitForExistence(timeout: 10))
        }
        step("pin_selected_region") {
            let pin = app.buttons["Add pin in selected region"]
            reveal(pin, in: app)
            pin.tap()
            let confirm = app.buttons["Pin this structure"]
            XCTAssertTrue(confirm.waitForExistence(timeout: 10))
            // The layer picker scrolls independently of the notebook page.
            let picker = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose anatomy layer")).firstMatch
            for _ in 0..<8 {
                if confirm.isHittable { break }
                picker.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.8))
                    .press(forDuration: 0.05, thenDragTo: picker.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.3)))
            }
            XCTAssertTrue(confirm.isHittable)
            confirm.tap()
            XCTAssertTrue(app.textViews["Note for spot 1"].waitForExistence(timeout: 10))
        }
        // Public fixture text; the chosen rating is synthetic test input.
        let note = "My left upper trap and high left neck feel stiff after sleeping on my side and stomach."
        let comment = "High left neck when looking down or turning left."
        let editor = app.textViews["Describe your discomfort"]
        let pinEditor = app.textViews["Note for spot 1"]
        step("write_pin_comment") {
            reveal(pinEditor, in: app)
            pinEditor.tap()
            pinEditor.typeText(comment)
            XCTAssertEqual(pinEditor.value as? String, comment)
            let done = app.buttons["Done"]
            if done.exists { done.tap() }
        }
        step("write_note") {
            reveal(editor, in: app, scrollUp: false)
            editor.tap()
            // One text event avoids repeated iOS keyboard animation waits in
            // the recorded session. The smoke test separately checks each word.
            editor.typeText(note)
            XCTAssertEqual(editor.value as? String, note)
            let done = app.buttons["Done"]
            if done.exists { done.tap() }
        }
        step("set_intensity") {
            let intensity = app.sliders["Reported intensity"]
            reveal(intensity, in: app)
            // WebKit's aria-valuetext range does not support XCTest's native
            // slider adjustment API. Use the same touch gesture as a person.
            intensity.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
                .press(forDuration: 0.1, thenDragTo: intensity.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)))
            XCTAssertTrue((intensity.value as? String)?.contains("out of 10") == true)
        }
        let rating = app.sliders["Reported intensity"].value as? String
        step("save_entry") {
            let save = app.buttons["Save entry"]
            reveal(save, in: app)
            save.tap()
            XCTAssertTrue(app.staticTexts["Entry saved on this device."].waitForExistence(timeout: 15))
        }
        screenshot("Saved fixture entry")
        for cycle in 1...3 {
            step("notebook_reopen_\(cycle)") {
                let notebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Notebook")).firstMatch
                // iOS scroll-to-top avoids turning the full-width 3D canvas
                // while trying to drag the notebook page back to its tabs.
                app.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: 40, dy: 10)).tap()
                let reachable = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "hittable == true"), object: notebook
                )
                XCTAssertEqual(XCTWaiter.wait(for: [reachable], timeout: 10), .completed)
                notebook.tap()
                let open = app.buttons["Open entry"]
                XCTAssertTrue(open.waitForExistence(timeout: 10))
                reveal(open, in: app)
                open.tap()
                XCTAssertTrue(editor.waitForExistence(timeout: 30))
                XCTAssertEqual(editor.value as? String, note)
                XCTAssertEqual(pinEditor.value as? String, comment)
                XCTAssertEqual(app.sliders["Reported intensity"].value as? String, rating)
                XCTAssertTrue(app.descendants(matching: .any)["Pin"].waitForExistence(timeout: 90))
            }
        }
        step("idle_after_reopen_15s") { Thread.sleep(forTimeInterval: 15) }
        step("export_json_share_sheet") {
            let export = app.buttons["Export JSON"]
            reveal(export, in: app)
            export.tap()
            let sheet = app.otherElements["ActivityListView"]
            XCTAssertTrue(sheet.waitForExistence(timeout: 15))
            // This runtime exposes actions as cells and presents a popover.
            // Also handle a Close button on sheet presentations.
            XCTAssertTrue(app.descendants(matching: .any)["Save to Files"].firstMatch.waitForExistence(timeout: 15))
            screenshot("Native JSON share sheet")
            let dismiss = app.otherElements["PopoverDismissRegion"]
            if dismiss.exists {
                dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.1)).tap()
            } else {
                app.buttons["Close"].firstMatch.tap()
            }
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: sheet)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 10), .completed)
        }
        step("background_10s") {
            XCUIDevice.shared.press(.home)
            XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
            Thread.sleep(forTimeInterval: 10)
        }
        step("resume_notebook") {
            app.activate()
            XCTAssertTrue(editor.waitForExistence(timeout: 30))
            XCTAssertFalse(app.otherElements["notebook-privacy-cover"].exists)
            XCTAssertEqual(editor.value as? String, note)
        }
        step("landscape_information") {
            XCUIDevice.shared.orientation = .landscapeLeft
            let about = app.buttons["Privacy & limitations"]
            reveal(about, in: app)
            about.tap()
            XCTAssertTrue(app.buttons["Close information"].waitForExistence(timeout: 10))
            screenshot("Landscape information")
            app.buttons["Close information"].tap()
        }
    }
}
