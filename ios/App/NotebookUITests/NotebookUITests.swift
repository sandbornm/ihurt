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
        editor.typeText(note)
        XCTAssertTrue(app.staticTexts["Draft saved on this device"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["New entry"].waitForExistence(timeout: 60))
        reveal(editor, in: app)
        XCTAssertEqual(editor.value as? String, note)

        let save = app.buttons["Save entry"]
        reveal(save, in: app)
        save.tap()
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
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Landscape information"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["Close information"].tap()
    }
}
