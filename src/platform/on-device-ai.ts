export interface OnDeviceAIAvailability {
  available: boolean;
  reason?: string;
}

// Raw fields copied from the dictated note. Treat as untrusted model output:
// src/voice/extraction.ts validates every field before anything is proposed.
export interface RawPainExtraction {
  spokenLocation: string;
  region: string;
  side: "left" | "right" | "both" | "unspecified";
  qualities: string[];
  intensity: number | null;
  onsetPhrase: string;
  activity: string;
  surface: string;
}

export interface OnDeviceAI {
  // Checking availability never downloads a model or asks for permission.
  isAvailable(): Promise<OnDeviceAIAvailability>;
  extractPainEntry(options: {
    transcript: string;
    anatomyList: string[];
    today: string;
  }): Promise<RawPainExtraction>;
  speak(text: string): Promise<void>;
  stopSpeaking(): Promise<void>;
}

export interface AppleIntelligenceBridge {
  isAvailable(): Promise<OnDeviceAIAvailability>;
  extractPainEntry(options: {
    transcript: string;
    anatomyList: string[];
    today: string;
  }): Promise<unknown>;
  speak(options: { text: string }): Promise<unknown>;
  stopSpeaking(): Promise<void>;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function parseRawExtraction(value: unknown): RawPainExtraction {
  if (!value || typeof value !== "object")
    throw new Error("Apple Intelligence returned no fields.");
  const raw = value as Record<string, unknown>;
  const side = ["left", "right", "both"].includes(raw.side as string)
    ? (raw.side as RawPainExtraction["side"])
    : "unspecified";
  const intensity =
    typeof raw.intensity === "number" &&
    Number.isInteger(raw.intensity) &&
    raw.intensity >= 0 &&
    raw.intensity <= 10
      ? raw.intensity
      : null;
  return {
    spokenLocation: text(raw.spokenLocation, 120),
    region: text(raw.region, 40),
    side,
    qualities: Array.isArray(raw.qualities)
      ? raw.qualities
          .map((item) => text(item, 40))
          .filter(Boolean)
          .slice(0, 5)
      : [],
    intensity,
    onsetPhrase: text(raw.onsetPhrase, 80),
    activity: text(raw.activity, 80),
    surface: text(raw.surface, 40),
  };
}

export function createAppleIntelligence(
  bridge: AppleIntelligenceBridge,
): OnDeviceAI {
  return {
    async isAvailable() {
      try {
        const state = await bridge.isAvailable();
        return { available: state.available === true, reason: state.reason };
      } catch {
        return { available: false };
      }
    },
    async extractPainEntry(options) {
      return parseRawExtraction(await bridge.extractPainEntry(options));
    },
    async speak(value) {
      await bridge.speak({ text: value.slice(0, 300) });
    },
    stopSpeaking: () => bridge.stopSpeaking(),
  };
}

let ai: OnDeviceAI | undefined;

export function configureOnDeviceAI(adapter: OnDeviceAI) {
  ai = adapter;
}

export const onDeviceAI = () => ai;
