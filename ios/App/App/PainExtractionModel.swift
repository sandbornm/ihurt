import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// Guided-generation schema and the on-device extract call. No UIKit or
// Capacitor imports, so the eval CLI can compile this file on macOS.
// schema v1 quotes fields. The web layer checks every field against the note.

#if canImport(FoundationModels)
@available(iOS 26.0, macOS 26.0, *)
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

@available(iOS 26.0, macOS 26.0, *)
enum PainExtractor {
    static let schema = "v1"

    // Stable codes. The plugin maps them to text in the app's language.
    static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible: return "ai-device-not-eligible"
        case .appleIntelligenceNotEnabled: return "ai-not-enabled"
        case .modelNotReady: return "ai-model-not-ready"
        @unknown default: return "ai-unavailable"
        }
    }

    // Instructions follow the app's language. Either way the model copies the
    // person's exact words and never translates them. The web layer checks
    // every field against the note and drops anything it cannot find.
    static func instructions(language: String, anatomy: [String]) -> String {
        let ids = anatomy.joined(separator: ", ")
        if language == "es" {
            return """
            Lees una nota corta que una persona dictó en español sobre una molestia en su propio cuerpo.
            Copia solo lo que dijo, con sus palabras exactas y en su idioma. Nunca traduzcas. No diagnostiques, no sugieras una causa ni des consejos.
            Nunca deduzcas una zona del cuerpo a partir de un deporte, una actividad o una superficie. Si no nombró una parte del cuerpo, deja spokenLocation vacío y usa la región "unknown".
            Los ids de anatomía permitidos (no los traduzcas): \(ids).
            En region, elige el único id permitido que contiene la parte del cuerpo que nombró. Un dedo del pie, el talón o el arco son parte del pie (foot). Un dedo de la mano, el pulgar o la palma son parte de la muñeca (wrist).
            En side usa solo los valores en inglés: "left" si dijo izquierdo o izquierda, "right" si dijo derecho o derecha, "both" si dijo ambos o los dos, y si no, "unspecified".
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

    static func extract(transcript: String, anatomy: [String], language: String = "en") async throws -> [String: Any] {
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
