import XCTest

@MainActor
final class NotebookUITests: XCTestCase {
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

        // Select the region named in the public fixture. Done dismisses the
        // search keyboard; finishing the search alone must not place a pin.
        let find = app.buttons["Find a region"]
        reveal(find, in: app)
        find.tap()
        let search = app.textFields["Search body regions"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("neck\n")
        let keyboardGone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "count == 0"), object: app.keyboards
        )
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardGone], timeout: 10), .completed)
        XCTAssertFalse(app.textViews["Note for spot 1"].exists)
        let neck = app.buttons["Neck"]
        XCTAssertTrue(neck.isHittable)
        neck.tap()
        let addPin = app.buttons["Add pin in selected region"]
        reveal(addPin, in: app)
        addPin.tap()
        let confirmPin = app.buttons["Pin this structure"]
        XCTAssertTrue(confirmPin.waitForExistence(timeout: 10))
        XCTAssertTrue(confirmPin.isHittable, "Pin confirmation must be reachable without scrolling the layer list.")
        let pickerScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        pickerScreenshot.name = "Pin confirmation before scrolling"
        pickerScreenshot.lifetime = .keepAlways
        add(pickerScreenshot)
        confirmPin.tap()
        XCTAssertTrue(app.textViews["Note for spot 1"].waitForExistence(timeout: 10))

        let about = app.buttons["Privacy & limitations"]
        reveal(about, in: app)
        about.tap()
        XCTAssertTrue(app.staticTexts["Your notebook, your data"].waitForExistence(timeout: 10))
        app.buttons["Close information"].tap()

        // These words come from the authorized public example, never a user's notebook.
        let phrases = [
            "My left upper trap and high left neck feel stiff",
            " after sleeping on my side and stomach."
        ]
        let note = phrases.joined()
        let editor = app.textViews["Describe your discomfort"]
        reveal(editor, in: app, scrollUp: false)
        editor.tap()
        // Pause between phrases so WebKit can consume synthesized keystrokes.
        // A single long burst can leave only a prefix visible on a busy runner;
        // per-word calls can each wait for a missing keyboard animation notice.
        var typed = ""
        for phrase in phrases {
            editor.typeText(phrase)
            typed += phrase
            let textArrived = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", typed), object: editor
            )
            XCTAssertEqual(XCTWaiter.wait(for: [textArrived], timeout: 10), .completed,
                           "The exact typed text must arrive before continuing. Actual: \(editor.value ?? "nil")")
        }
        XCTAssertEqual(editor.value as? String, note, "Typing must finish before the persistence check.")
        XCTAssertLessThanOrEqual(app.webViews.firstMatch.frame.width, app.frame.width + 1,
                                 "Focusing the note must not enlarge the page beyond the device width.")
        XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["New entry"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any)["Pin"].waitForExistence(timeout: 90))
        reveal(editor, in: app)
        XCTAssertEqual(editor.value as? String, note)
        XCTAssertTrue(app.textViews["Note for spot 1"].exists)

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
}
