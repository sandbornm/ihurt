import AVFoundation
import Capacitor
import Speech
import UIKit

@objc(AppleSpeechPlugin)
public class AppleSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSpeechPlugin"
    public let jsName = "AppleSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

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
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.finish(error: "Recording stopped when iHurt went into the background.")
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.finish(error: "Recording was interrupted. You can review the words captured so far.")
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.finish(error: "The microphone stopped. Try recording again.")
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

    private func unavailableReason() -> String? {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .denied, .restricted:
            return "Allow Speech Recognition for iHurt in Settings to dictate a draft."
        default: break
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted:
            return "Allow Microphone access for iHurt in Settings to dictate a draft."
        default: break
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current),
              recognizer.supportsOnDeviceRecognition else {
            return "On-device Apple speech is unavailable for this device language. You can type your note."
        }
        guard recognizer.isAvailable else {
            return "Apple speech is temporarily unavailable. Try again or type your note."
        }
        return nil
    }

    @objc func availability(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let reason = self.unavailableReason() {
                call.resolve(["available": false, "reason": reason])
            } else {
                call.resolve(["available": true])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.session == nil else {
                call.reject("A recording is already in progress.")
                return
            }
            guard let id = call.getString("session"), UUID(uuidString: id) != nil else {
                call.reject("Invalid recording session.")
                return
            }
            if let reason = self.unavailableReason() {
                call.reject(reason)
                return
            }
            self.session = id
            self.completedSession = nil
            self.completedError = nil
            self.transcript = ""
            self.startCall = call
            // Permission prompts occur only after an explicit recording action.
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    guard let self, self.session == id else { return }
                    guard status == .authorized else {
                        self.finish(error: "Speech recognition permission was not granted.")
                        return
                    }
                    AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                        DispatchQueue.main.async {
                            guard let self, self.session == id else { return }
                            guard allowed else {
                                self.finish(error: "Microphone permission was not granted.")
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
            finish(error: "Return to iHurt to start recording.")
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current),
              recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else {
            finish(error: "On-device Apple speech is unavailable. You can type your note.")
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
                finish(error: "No microphone is available. Check your audio device and retry.")
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
                        self.finish(error: "Apple speech could not finish this recording. Review the words captured so far or try again.")
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
            finish(error: "The microphone could not start. Check permission and your audio device, then retry.")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let id = call.getString("session")
            guard self.session != nil, self.session == id else {
                if self.completedSession == id {
                    if let error = self.completedError { call.reject(error) }
                    else { call.resolve(["text": self.transcript]) }
                } else { call.reject("This recording is no longer active.") }
                return
            }
            self.stopCalls.append(call)
            guard self.startCall == nil else {
                self.finish(error: "Recording stopped before the microphone was ready.")
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
            self?.finish(error: "Apple speech did not finish in time. Review the words captured so far.")
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.session == call.getString("session") {
                self.finish(error: "Recording cancelled.", notify: false)
                self.transcript = ""
            } else if self.completedSession == call.getString("session") {
                self.transcript = ""
                self.completedSession = nil
                self.completedError = nil
            }
            call.resolve()
        }
    }

    private func finish(error: String? = nil, notify: Bool = true) {
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
        startCall?.reject(error ?? "Recording ended before the microphone was ready.")
        startCall = nil
        for call in stopCalls {
            if let error { call.reject(error) }
            else { call.resolve(["text": transcript]) }
        }
        stopCalls.removeAll()
        if notify {
            var event: [String: Any] = ["session": id]
            if let error { event["error"] = error }
            notifyListeners("ended", data: event)
        }
    }
}
