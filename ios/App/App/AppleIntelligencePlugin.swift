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

    // Main thread only. Compiled only where FoundationModels exists, so an SDK
    // without it still builds and reports unavailable.
    #if canImport(FoundationModels)
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
    #endif

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

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct PainExtraction {
    @Guide(description: "The body part exactly as the person said it, in their language and never translated, for example 'left big toe joint' or 'dedo gordo del pie izquierdo'. Empty if they named no body part.")
    var spokenLocation: String

    @Guide(description: "One id from the allowed anatomy list that contains the spoken body part, or 'unknown'.")
    var region: String

    @Guide(description: "The side the person said.", .anyOf(["left", "right", "both", "unspecified"]))
    var side: String

    @Guide(description: "Words the person used for how it feels, copied in their language, such as burning, sharp or tight, or ardor, punzante or sordo. Empty if none.")
    var qualities: [String]

    @Guide(description: "Pain intensity from 0 to 10 only if the person said a number. -1 if they did not.", .range(-1...10))
    var intensity: Int

    @Guide(description: "When it started, in the person's words and language, such as 'yesterday', '3 days ago' or 'ayer'. Empty if not said.")
    var onsetPhrase: String

    @Guide(description: "The activity the person said they were doing, in their words, such as padel, running or pádel. Empty if none.")
    var activity: String

    @Guide(description: "The playing or running surface the person named, such as turf, clay or concrete. Empty if none.")
    var surface: String
}

@available(iOS 26.0, *)
enum PainExtractor {
    static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible: return "ai-device-not-eligible"
        case .appleIntelligenceNotEnabled: return "ai-not-enabled"
        case .modelNotReady: return "ai-model-not-ready"
        @unknown default: return "ai-unavailable"
        }
    }

    // Instructions follow the app's language. Either way the model copies the
    // person's exact words and never translates them: the web layer grounds
    // every field in the transcript and drops anything it cannot find.
    static func instructions(language: String, anatomy: [String]) -> String {
        let ids = anatomy.joined(separator: ", ")
        if language == "es" {
            return """
            Lees una nota corta que una persona dictó en español sobre una molestia en su propio cuerpo.
            Copia solo lo que dijo, con sus palabras exactas y en su idioma. Nunca traduzcas. No diagnostiques, no sugieras una causa ni des consejos.
            Nunca deduzcas una zona del cuerpo a partir de un deporte, una actividad o una superficie. Si no nombró una parte del cuerpo, deja spokenLocation vacío y usa la región "unknown".
            Los ids de anatomía permitidos (no los traduzcas): \(ids).
            En region, elige el único id permitido que contiene la parte del cuerpo que nombró. Un dedo del pie, el talón o el arco son parte del pie (foot). Un dedo de la mano, el pulgar o la palma son parte de la muñeca (wrist).
            En side usa solo los valores en inglés: "left" si dijo izquierdo o izquierda, "right" si dijo derecho o derecha (pero "derecho" en "camino derecho" o "voy derecho" significa recto, no un lado), "both" si dijo ambos o los dos, y si no, "unspecified".
            En qualities copia las palabras que usó para cómo se siente, como ardor, punzante, sordo u hormigueo. En onsetPhrase copia cuándo empezó, como "ayer" o "hace 3 días".
            """
        }
        return """
        You read one short note a person dictated about their own body discomfort.
        Copy only what they said, in their exact words. Never translate. Do not diagnose, suggest a cause, or add advice.
        Never infer a body location from a sport, activity or surface. If they did not name a body part, use an empty spokenLocation and region "unknown".
        Allowed anatomy ids: \(ids).
        For region, choose the single allowed id that contains the body part they named. A toe, heel or arch is part of the foot. A finger, thumb or palm is part of the wrist.
        """
    }

    static func extract(transcript: String, anatomy: [String], language: String) async throws -> [String: Any] {
        let instructions = instructions(language: language, anatomy: anatomy)
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(
            to: (language == "es" ? "Nota: " : "Note: ") + transcript,
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
