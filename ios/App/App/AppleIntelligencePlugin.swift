import AVFoundation
import Capacitor
import Foundation
import UIKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// Reads a dictated note on the device with Apple Foundation Models and speaks
// one short follow-up question. Output is a proposal: the web layer validates it
// against the anatomy list and nothing is saved until the person confirms.
@objc(AppleIntelligencePlugin)
public class AppleIntelligencePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "AppleIntelligencePlugin"
    public let jsName = "AppleIntelligence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extractPainEntry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelExtraction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise)
    ]

    private var synthesizer = AVSpeechSynthesizer()
    private var ownsAudioSession = false
    // Extraction state is touched only on the main thread. A new request
    // replaces the one in flight, so nothing can stay stuck "busy".
    private var extraction: PendingExtraction?
    static let extractionTimeout: TimeInterval = 25
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        synthesizer.delegate = self
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.halt()
            self?.finishExtraction(cancelled: true)
        })
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        synthesizer.stopSpeaking(at: .immediate)
    }

    // Each failure is sent as a stable code. The web layer shows it in the
    // app's language; these English messages are the fallback.
    static let messages: [String: String] = [
        "ai-unavailable": "Apple Intelligence needs iOS 26 or later on a supported device. Your transcript still goes into the note.",
        "ai-device-not-eligible": "This device does not support Apple Intelligence. Your transcript still goes into the note.",
        "ai-not-enabled": "Turn on Apple Intelligence in Settings to fill fields from your voice. Your transcript still goes into the note.",
        "ai-model-not-ready": "Apple Intelligence is still getting ready. Try again later; your transcript still goes into the note.",
        "ai-locale-unsupported": "Apple Intelligence does not support this language on this device yet. Dictation still works; review and fill the fields yourself.",
        "transcript-too-long": "Use a transcript of 3,000 characters or fewer.",
        "invalid-anatomy": "Invalid anatomy list.",
        "ai-failed": "Apple Intelligence could not read this note. Review the transcript and fields yourself.",
        "ai-timeout": "Apple Intelligence took too long. Review the transcript and fields yourself.",
        "ai-cancelled": "Apple Intelligence stopped reading this note.",
        "question-too-long": "Use a question of 300 characters or fewer."
    ]

    static func failure(_ code: String) -> [String: Any] {
        ["available": false, "code": code, "reason": messages[code] ?? code]
    }

    private func reject(_ call: CAPPluginCall, _ code: String) {
        call.reject(Self.messages[code] ?? code, code)
    }

    // The app's language setting, sent as "en" or "es" with a BCP 47 locale.
    static func requestLocale(_ call: CAPPluginCall) -> Locale {
        guard let id = call.getString("locale"), !id.isEmpty, id.count <= 35 else { return Locale.current }
        return Locale(identifier: id)
    }

    static func requestLanguage(_ call: CAPPluginCall) -> String {
        call.getString("language") == "es" ? "es" : "en"
    }

    // nil when the model can read notes in this locale, else a failure code.
    static func unavailableCode(_ locale: Locale) -> String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                return model.supportsLocale(locale) ? nil : "ai-locale-unsupported"
            case .unavailable(let reason):
                return PainExtractor.describe(reason)
            @unknown default:
                return "ai-unavailable"
            }
        }
        #endif
        return "ai-unavailable"
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        if let code = Self.unavailableCode(Self.requestLocale(call)) {
            call.resolve(Self.failure(code))
        } else {
            call.resolve(["available": true])
        }
    }

    @objc func extractPainEntry(_ call: CAPPluginCall) {
        let transcript = (call.getString("transcript") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty, transcript.count <= 3000 else {
            reject(call, "transcript-too-long")
            return
        }
        let anatomy = (call.getArray("anatomyList") ?? []).compactMap { $0 as? String }
        guard !anatomy.isEmpty, anatomy.count <= 100,
              anatomy.allSatisfy({ $0.range(of: "^[a-z_]{1,40}$", options: .regularExpression) != nil }) else {
            reject(call, "invalid-anatomy")
            return
        }
        let today = call.getString("today") ?? ""
        let language = Self.requestLanguage(call)
        if let code = Self.unavailableCode(Self.requestLocale(call)) {
            reject(call, code)
            return
        }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            DispatchQueue.main.async {
                self.startExtraction(call, transcript: transcript, anatomy: anatomy, today: today, language: language)
            }
            return
        }
        #endif
        reject(call, "ai-unavailable")
    }

    // Main thread only.
    @available(iOS 26.0, *)
    private func startExtraction(_ call: CAPPluginCall, transcript: String, anatomy: [String], today: String, language: String) {
        finishExtraction(cancelled: true)
        let pending = PendingExtraction(call: call)
        extraction = pending
        pending.task = Task { @MainActor [weak self] in
            do {
                var result = try await PainExtractor.extract(transcript: transcript, anatomy: anatomy, language: language)
                result["today"] = today
                pending.resolve(result)
            } catch {
                pending.reject(code: "ai-failed")
            }
            if self?.extraction === pending { self?.extraction = nil }
        }
        // The web layer times out first; this is a backstop so a call
        // can never stay open if the model stops answering.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.extractionTimeout) { [weak self] in
            guard let self, self.extraction === pending else { return }
            pending.reject(code: "ai-timeout")
            pending.task?.cancel()
            self.extraction = nil
        }
    }

    @objc func cancelExtraction(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishExtraction(cancelled: true)
            call.resolve()
        }
    }

    // Main thread only.
    private func finishExtraction(cancelled: Bool) {
        guard let pending = extraction else { return }
        extraction = nil
        pending.task?.cancel()
        if cancelled { pending.reject(code: "ai-cancelled") }
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = (call.getString("text") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 300 else {
            reject(call, "question-too-long")
            return
        }
        let locale = Self.requestLocale(call)
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .background else {
                call.resolve(["spoken": false])
                return
            }
            self.synthesizer.stopSpeaking(at: .immediate)
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                try session.setActive(true)
                self.ownsAudioSession = true
            } catch {
                // The question is also shown as text, so report it unspoken.
                call.resolve(["spoken": false])
                return
            }
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = Self.voice(for: locale)
            self.synthesizer.speak(utterance)
            call.resolve(["spoken": true])
        }
    }

    // A voice for the app's language: the exact locale, then any installed
    // voice of that language, then the system default.
    static func voice(for locale: Locale) -> AVSpeechSynthesisVoice? {
        let id = locale.identifier.replacingOccurrences(of: "_", with: "-")
        if let exact = AVSpeechSynthesisVoice(language: id) { return exact }
        let language = locale.language.languageCode?.identifier ?? String(id.prefix(2))
        return AVSpeechSynthesisVoice.speechVoices().first { $0.language.hasPrefix(language + "-") }
            ?? AVSpeechSynthesisVoice(language: language)
            ?? AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
    }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.halt()
            call.resolve()
        }
    }

    private func halt() {
        synthesizer.stopSpeaking(at: .immediate)
        releaseAudioSession()
    }

    private func releaseAudioSession() {
        guard ownsAudioSession else { return }
        ownsAudioSession = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { if !self.synthesizer.isSpeaking { self.releaseAudioSession() } }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { if !self.synthesizer.isSpeaking { self.releaseAudioSession() } }
    }
}

// One extraction call. Settles its Capacitor call exactly once; main thread only.
final class PendingExtraction {
    private let call: CAPPluginCall
    private var settled = false
    var task: Task<Void, Never>?

    init(call: CAPPluginCall) { self.call = call }

    func resolve(_ data: [String: Any]) {
        guard !settled else { return }
        settled = true
        call.resolve(data)
    }

    func reject(code: String) {
        guard !settled else { return }
        settled = true
        call.reject(AppleIntelligencePlugin.messages[code] ?? code, code)
    }
}

