import AVFoundation
import Capacitor
import Speech
import UIKit
import WebKit

@objc(AppleSpeechPlugin)
public class AppleSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSpeechPlugin"
    public let jsName = "AppleSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "languages", returnType: CAPPluginReturnPromise)
    ]

    static let messages: [String: String] = [
        "speech-permission-denied": "Allow Speech Recognition for iHurt in Settings to dictate a draft.",
        "mic-permission-denied": "Allow Microphone access for iHurt in Settings to dictate a draft.",
        "speech-locale-unsupported": "On-device Apple speech is unavailable for this language. You can type your note.",
        "speech-temporarily-unavailable": "Apple speech is temporarily unavailable. Try again or type your note.",
        "page-changed": "Recording stopped because the page changed.",
        "background": "Recording stopped when iHurt went into the background.",
        "interrupted": "Recording was interrupted. You can review the words captured so far.",
        "mic-reset": "The microphone stopped. Try recording again.",
        "already-recording": "A recording is already in progress.",
        "invalid-session": "Invalid recording session.",
        "speech-not-granted": "Speech recognition permission was not granted.",
        "mic-not-granted": "Microphone permission was not granted.",
        "return-to-app": "Return to iHurt to start recording.",
        "speech-unavailable": "On-device Apple speech is unavailable. You can type your note.",
        "no-mic": "No microphone is available. Check your audio device and retry.",
        "speech-failed": "Apple speech could not finish this recording. Review the words captured so far or try again.",
        "mic-failed": "The microphone could not start. Check permission and your audio device, then retry.",
        "not-active": "This recording is no longer active.",
        "stopped-before-ready": "Recording stopped before the microphone was ready.",
        "speech-timeout": "Apple speech did not finish in time. Review the words captured so far.",
        "cancelled": "Recording cancelled.",
        "ended-before-ready": "Recording ended before the microphone was ready."
    ]

    private func reject(_ call: CAPPluginCall, _ code: String) {
        call.reject(Self.messages[code] ?? code, code)
    }

    static func speechLocale(_ call: CAPPluginCall) -> Locale {
        guard let id = call.getString("locale"), !id.isEmpty, id.count <= 35 else { return Locale.current }
        return Locale(identifier: id)
    }

    private var locale = Locale.current

    static func recognizer(for locale: Locale) -> SFSpeechRecognizer? {
        if let exact = SFSpeechRecognizer(locale: locale), exact.supportsOnDeviceRecognition { return exact }
        guard let language = locale.language.languageCode?.identifier else { return nil }
        let candidates = SFSpeechRecognizer.supportedLocales()
            .filter { $0.language.languageCode?.identifier == language }
            .sorted { $0.identifier < $1.identifier }
        for candidate in candidates {
            if let recognizer = SFSpeechRecognizer(locale: candidate), recognizer.supportsOnDeviceRecognition {
                return recognizer
            }
        }
        return nil
    }

    private var session: String?
    private var completedSession: String?
    private var completedError: String?
    private var transcript = ""
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var hasTap = false
    private var ownsAudioSession = false
    private var startCall: CAPPluginCall?
    private var stopCalls: [CAPPluginCall] = []
    private var finalTimer: Timer?
    private var limitTimer: Timer?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        observers.append(NotificationCenter.default.addObserver(
            forName: .capacitorDecidePolicyForNavigationAction, object: nil, queue: .main
        ) { [weak self] notification in
            guard let navigation = notification.object as? WKNavigationAction,
                  navigation.targetFrame?.isMainFrame == true else { return }
            self?.finish(code: "page-changed")
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.finish(code: "background")
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.finish(code: "interrupted")
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.finish(code: "mic-reset")
        })
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        finalTimer?.invalidate()
        limitTimer?.invalidate()
        engine?.stop()
        if hasTap { engine?.inputNode.removeTap(onBus: 0) }
        request?.endAudio()
        task?.cancel()
        if ownsAudioSession { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    private func unavailableReason(_ locale: Locale) -> String? {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .denied, .restricted:
            return "speech-permission-denied"
        default: break
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted:
            return "mic-permission-denied"
        default: break
        }
        guard let recognizer = Self.recognizer(for: locale) else {
            return "speech-locale-unsupported"
        }
        guard recognizer.isAvailable else {
            return "speech-temporarily-unavailable"
        }
        return nil
    }

    @objc func availability(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let locale = Self.speechLocale(call)
            if let code = self.unavailableReason(locale) {
                call.resolve([
                    "available": false,
                    "code": code,
                    "reason": Self.messages[code] ?? code,
                    "locale": locale.identifier
                ])
            } else {
                call.resolve(["available": true])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.session == nil else {
                self.reject(call, "already-recording")
                return
            }
            guard let id = call.getString("session"), UUID(uuidString: id) != nil else {
                self.reject(call, "invalid-session")
                return
            }
            let locale = Self.speechLocale(call)
            if let code = self.unavailableReason(locale) {
                self.reject(call, code)
                return
            }
            self.locale = locale
            self.session = id
            self.completedSession = nil
            self.completedError = nil
            self.transcript = ""
            self.startCall = call
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    guard let self, self.session == id else { return }
                    guard status == .authorized else {
                        self.finish(code: "speech-not-granted")
                        return
                    }
                    AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                        DispatchQueue.main.async {
                            guard let self, self.session == id else { return }
                            guard allowed else {
                                self.finish(code: "mic-not-granted")
                                return
                            }
                            self.beginRecording(id)
                        }
                    }
                }
            }
        }
    }

    private func beginRecording(_ id: String) {
        guard UIApplication.shared.applicationState != .background else {
            finish(code: "return-to-app")
            return
        }
        guard let recognizer = Self.recognizer(for: locale), recognizer.isAvailable else {
            finish(code: "speech-unavailable")
            return
        }
        self.recognizer = recognizer
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            ownsAudioSession = true
            let engine = AVAudioEngine()
            self.engine = engine
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                finish(code: "no-mic")
                return
            }
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            request.taskHint = .dictation
            self.request = request
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            hasTap = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, self.session == id else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        self.notifyListeners("transcript", data: ["session": id, "text": self.transcript])
                        if result.isFinal {
                            self.finish()
                            return
                        }
                    }
                    if error != nil {
                        self.finish(code: "speech-failed")
                    }
                }
            }
            engine.prepare()
            try engine.start()
            limitTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in
                self?.endAudio()
            }
            startCall?.resolve()
            startCall = nil
        } catch {
            finish(code: "mic-failed")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("session"), UUID(uuidString: id) != nil else {
                self.reject(call, "invalid-session")
                return
            }
            guard self.session != nil, self.session == id else {
                if self.completedSession == id {
                    if let error = self.completedError { self.reject(call, error) }
                    else { call.resolve(["text": self.transcript]) }
                } else { self.reject(call, "not-active") }
                return
            }
            self.stopCalls.append(call)
            guard self.startCall == nil else {
                self.finish(code: "stopped-before-ready")
                return
            }
            self.endAudio()
        }
    }

    private func stopMicrophone() {
        engine?.stop()
        if hasTap {
            engine?.inputNode.removeTap(onBus: 0)
            hasTap = false
        }
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
    }

    private func endAudio() {
        guard session != nil, finalTimer == nil else { return }
        stopMicrophone()
        request?.endAudio()
        limitTimer?.invalidate()
        limitTimer = nil
        finalTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            self?.finish(code: "speech-timeout")
        }
    }

    @objc func languages(_ call: CAPPluginCall) {
        call.resolve(["languages": Locale.preferredLanguages])
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("session"), UUID(uuidString: id) != nil else {
                self.reject(call, "invalid-session")
                return
            }
            if self.session == id {
                self.finish(code: "cancelled", notify: false)
                self.transcript = ""
            } else if self.completedSession == id {
                self.transcript = ""
                self.completedSession = nil
                self.completedError = nil
            }
            call.resolve()
        }
    }

    private func finish(code error: String? = nil, notify: Bool = true) {
        guard let id = session else { return }
        session = nil
        completedSession = id
        completedError = error
        finalTimer?.invalidate()
        finalTimer = nil
        limitTimer?.invalidate()
        limitTimer = nil
        stopMicrophone()
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        recognizer = nil
        engine = nil
        if let startCall { reject(startCall, error ?? "ended-before-ready") }
        startCall = nil
        for call in stopCalls {
            if let error { reject(call, error) }
            else { call.resolve(["text": transcript]) }
        }
        stopCalls.removeAll()
        if notify {
            var event: [String: Any] = ["session": id]
            if let error {
                event["error"] = Self.messages[error] ?? error
                event["code"] = error
            }
            notifyListeners("ended", data: event)
        }
    }
}
