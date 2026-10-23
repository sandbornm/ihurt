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

@available(iOS 26.0, macOS 26.0, *)
enum PainExtractor {
    static let schema = "v1"

    static let unavailableMessage =
        "Apple Intelligence needs iOS 26 or later on a supported device. Your transcript still goes into the note."

    static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            return "This device does not support Apple Intelligence. Your transcript still goes into the note."
        case .appleIntelligenceNotEnabled:
            return "Turn on Apple Intelligence in Settings to fill fields from your voice. Your transcript still goes into the note."
        case .modelNotReady:
            return "Apple Intelligence is still getting ready. Try again later; your transcript still goes into the note."
        @unknown default:
            return unavailableMessage
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
