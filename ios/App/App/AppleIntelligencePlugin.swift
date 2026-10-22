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
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise)
    ]

    private var synthesizer = AVSpeechSynthesizer()
    private var ownsAudioSession = false
    private var extracting = false
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        synthesizer.delegate = self
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.halt()
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
            guard !extracting else {
                call.reject("Apple Intelligence is already reading a note.")
                return
            }
            extracting = true
            Task { [weak self] in
                defer { DispatchQueue.main.async { self?.extracting = false } }
                do {
                    var result = try await PainExtractor.extract(transcript: transcript, anatomy: anatomy)
                    result["today"] = today
                    call.resolve(result)
                } catch {
                    call.reject("Apple Intelligence could not read this note. Review the transcript and fields yourself.")
                }
            }
            return
        }
        #endif
        call.reject(Self.unavailableMessage)
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
                // The question is also shown as text, so a muted route is not an error.
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

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct PainExtraction {
    @Guide(description: "The body part exactly as the person said it, for example 'left big toe joint'. Empty if they named no body part.")
    var spokenLocation: String

    @Guide(description: "One id from the allowed anatomy list that contains the spoken body part, or 'unknown'.")
    var region: String

    @Guide(description: "The side the person said.", .anyOf(["left", "right", "both", "unspecified"]))
    var side: String

    @Guide(description: "Words the person used for how it feels, such as burning, sharp, aching or tight. Empty if none.")
    var qualities: [String]

    @Guide(description: "Pain intensity from 0 to 10 only if the person said a number. -1 if they did not.", .range(-1...10))
    var intensity: Int

    @Guide(description: "When it started, in the person's words, such as 'yesterday' or '3 days ago'. Empty if not said.")
    var onsetPhrase: String

    @Guide(description: "The activity the person said they were doing, such as padel or running. Empty if none.")
    var activity: String

    @Guide(description: "The playing or running surface the person named, such as turf, clay or concrete. Empty if none.")
    var surface: String
}

@available(iOS 26.0, *)
enum PainExtractor {
    static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            return "This device does not support Apple Intelligence. Your transcript still goes into the note."
        case .appleIntelligenceNotEnabled:
            return "Turn on Apple Intelligence in Settings to fill fields from your voice. Your transcript still goes into the note."
        case .modelNotReady:
            return "Apple Intelligence is still getting ready. Try again later; your transcript still goes into the note."
        @unknown default:
            return AppleIntelligencePlugin.unavailableMessage
        }
    }

    static func extract(transcript: String, anatomy: [String]) async throws -> [String: Any] {
        let instructions = """
        You read one short note a person dictated about their own body discomfort.
        Copy only what they said. Do not diagnose, suggest a cause, or add advice.
        Never infer a body location from a sport, activity or surface. If they did not name a body part, use an empty spokenLocation and region "unknown".
        Allowed anatomy ids: \(anatomy.joined(separator: ", ")).
        For region, choose the single allowed id that contains the body part they named. A toe, heel or arch is part of the foot. A finger, thumb or palm is part of the wrist.
        """
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(
            to: "Note: \(transcript)",
            generating: PainExtraction.self,
            options: GenerationOptions(temperature: 0)
        )
        let value = response.content
        return [
            "spokenLocation": String(value.spokenLocation.prefix(120)),
            "region": String(value.region.prefix(40)),
            "side": value.side,
            "qualities": value.qualities.prefix(5).map { String($0.prefix(40)) },
            "intensity": value.intensity,
            "onsetPhrase": String(value.onsetPhrase.prefix(80)),
            "activity": String(value.activity.prefix(80)),
            "surface": String(value.surface.prefix(40))
        ]
    }
}
#endif
