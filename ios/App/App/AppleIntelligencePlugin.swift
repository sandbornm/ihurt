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

    static let unavailableMessage =
        "Apple Intelligence needs iOS 26 or later on a supported device. Your transcript still goes into the note."

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": PainExtractor.describe(reason)])
            @unknown default:
                call.resolve(["available": false, "reason": Self.unavailableMessage])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": Self.unavailableMessage])
    }

    @objc func extractPainEntry(_ call: CAPPluginCall) {
        let transcript = (call.getString("transcript") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty, transcript.count <= 3000 else {
            call.reject("Use a transcript of 3,000 characters or fewer.")
            return
        }
        let anatomy = (call.getArray("anatomyList") ?? []).compactMap { $0 as? String }
        guard !anatomy.isEmpty, anatomy.count <= 100,
              anatomy.allSatisfy({ $0.range(of: "^[a-z_]{1,40}$", options: .regularExpression) != nil }) else {
            call.reject("Invalid anatomy list.")
            return
        }
        let today = call.getString("today") ?? ""
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                call.reject(Self.unavailableMessage)
                return
            }
            DispatchQueue.main.async {
                self.startExtraction(call, transcript: transcript, anatomy: anatomy, today: today)
            }
            return
        }
        #endif
        call.reject(Self.unavailableMessage)
    }

    // Main thread only.
    @available(iOS 26.0, *)
    private func startExtraction(_ call: CAPPluginCall, transcript: String, anatomy: [String], today: String) {
        finishExtraction(cancelled: true)
        let pending = PendingExtraction(call: call)
        extraction = pending
        pending.task = Task { @MainActor [weak self] in
            do {
                var result = try await PainExtractor.extract(transcript: transcript, anatomy: anatomy)
                result["today"] = today
                pending.resolve(result)
            } catch {
                pending.reject("Apple Intelligence could not read this note. Review the transcript and fields yourself.")
            }
            if self?.extraction === pending { self?.extraction = nil }
        }
        // The web layer times out first; this is a backstop so a call
        // can never stay open if the model stops answering.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.extractionTimeout) { [weak self] in
            guard let self, self.extraction === pending else { return }
            pending.reject("Apple Intelligence took too long. Review the transcript and fields yourself.", code: "TIMEOUT")
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
        if cancelled { pending.reject("Apple Intelligence stopped reading this note.", code: "CANCELLED") }
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = (call.getString("text") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 300 else {
            call.reject("Use a question of 300 characters or fewer.")
            return
        }
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
            utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
            self.synthesizer.speak(utterance)
            call.resolve(["spoken": true])
        }
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

    func reject(_ message: String, code: String? = nil) {
        guard !settled else { return }
        settled = true
        call.reject(message, code)
    }
}

