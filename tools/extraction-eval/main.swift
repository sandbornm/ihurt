import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

@main
struct ExtractionEval {
    static func main() async {
        let argv = Array(CommandLine.arguments.dropFirst())
        func value(_ name: String) -> String? {
            guard let index = argv.firstIndex(of: name), index + 1 < argv.count else { return nil }
            return argv[index + 1]
        }
        guard let casesPath = value("--cases"),
              let anatomyPath = value("--anatomy"),
              let outPath = value("--out"),
              let name = value("--name") else {
            fputs("Usage: fm-eval --cases cases.json --anatomy anatomy.json --out recorded.json --name <name> [--limit N]\n", stderr)
            exit(2)
        }
        let limit = Int(value("--limit") ?? "") ?? Int.max
        do {
            try await run(
                casesURL: URL(fileURLWithPath: casesPath),
                anatomyURL: URL(fileURLWithPath: anatomyPath),
                outURL: URL(fileURLWithPath: outPath),
                name: name,
                limit: limit
            )
        } catch {
            fputs("extraction eval failed: \(error)\n", stderr)
            exit(1)
        }
    }

    static func run(casesURL: URL, anatomyURL: URL, outURL: URL, name: String, limit: Int) async throws {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            try await record(casesURL: casesURL, anatomyURL: anatomyURL, outURL: outURL, name: name, limit: limit)
            return
        }
        #endif
        fputs("Apple Intelligence needs macOS 26 or later with the FoundationModels SDK.\n", stderr)
        exit(1)
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
func record(casesURL: URL, anatomyURL: URL, outURL: URL, name: String, limit: Int) async throws {
    guard case .available = SystemLanguageModel.default.availability else {
        fputs("Apple Intelligence is not available on this Mac.\n", stderr)
        exit(1)
    }
    let anatomyData = try Data(contentsOf: anatomyURL)
    let anatomy = try JSONSerialization.jsonObject(with: anatomyData) as? [String] ?? []
    guard !anatomy.isEmpty else {
        fputs("Anatomy list is empty.\n", stderr)
        exit(1)
    }
    let casesData = try Data(contentsOf: casesURL)
    let cases = try JSONSerialization.jsonObject(with: casesData) as? [[String: Any]] ?? []
    let chosen = Array(cases.prefix(limit))
    var outputs: [String: Any] = [:]
    var errors: [String: String] = [:]
    let today = "2026-10-22"
    for (index, item) in chosen.enumerated() {
        let id = item["id"] as? String ?? "case-\(index)"
        let note = item["note"] as? String ?? ""
        let language = (item["lang"] as? String) == "es" ? "es" : "en"
        fputs("[\(index + 1)/\(chosen.count)] \(id)\n", stderr)
        fflush(stderr)
        do {
            let extracted = try await extractLimited(note: note, anatomy: anatomy, language: language)
            var row = extracted
            row["today"] = today
            outputs[id] = row
        } catch {
            errors[id] = String(describing: error)
            fputs("  error: \(error)\n", stderr)
        }
    }
    let metadata = modelMetadata(name: name, cases: chosen.count, errors: errors.count)
    let payload: [String: Any] = [
        "metadata": metadata,
        "outputs": outputs,
        "errors": errors,
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: outURL)
    fputs("Wrote \(outputs.count) outputs to \(outURL.path)\n", stderr)
}

@available(macOS 26.0, *)
func extractLimited(note: String, anatomy: [String], language: String) async throws -> [String: Any] {
    let work = Task { try await PainExtractor.extract(transcript: note, anatomy: anatomy, language: language) }
    let timer = Task {
        try await Task.sleep(nanoseconds: 45_000_000_000)
        work.cancel()
    }
    do {
        let value = try await work.value
        timer.cancel()
        return value
    } catch {
        timer.cancel()
        throw error
    }
}

@available(macOS 26.0, *)
func modelMetadata(name: String, cases: Int, errors: Int) -> [String: Any] {
    let model = SystemLanguageModel.default
    let languages = model.supportedLanguages.map(\.minimalIdentifier).sorted()
    var info: [String: Any] = [
        "name": name,
        "schema": PainExtractor.schema,
        "temperature": 0,
        "model": "SystemLanguageModel.default",
        "supportedLanguages": languages,
        "supportsEnglish": model.supportsLocale(Locale(identifier: "en")),
        "supportsSpanish": model.supportsLocale(Locale(identifier: "es")),
        "osVersionString": ProcessInfo.processInfo.operatingSystemVersionString,
        "osProduct": swVers("productVersion"),
        "osBuild": swVers("buildVersion"),
        "recordedAt": ISO8601DateFormatter().string(from: Date()),
        "cases": cases,
        "errorCount": errors,
    ]
    if #available(macOS 27.0, *) {
        info["modelVariant"] = model.variant.displayName
    }
    return info
}

func swVers(_ key: String) -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sw_vers")
    process.arguments = ["-\(key)"]
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = Pipe()
    do {
        try process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    } catch {
        return ""
    }
}
#endif
