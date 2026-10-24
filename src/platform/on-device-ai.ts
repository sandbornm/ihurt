import {
  language as currentLanguage,
  speechLocale,
  t,
  type Language,
} from "../i18n/index.ts";
import { nativeError, nativeMessage } from "./native-messages.ts";

export interface OnDeviceAIAvailability {
  available: boolean;
  reason?: string;
  code?: string;
}

// Raw fields copied from the dictated note. Treat as untrusted model output:
// src/voice/extraction.ts validates every field before anything is proposed.
// schema v2 carries evidence spans. The flat fields are the older shape.
export interface EvidenceLocation {
  evidence: string;
  negated: boolean;
  sideEvidence: string;
}

export interface EvidenceIntensity {
  evidence: string;
  value: number;
  kind: "rating" | "duration" | "count" | "other";
  negated: boolean;
}

export interface EvidenceMark {
  evidence: string;
  negated: boolean;
}

export interface EvidenceExtraction {
  locations: EvidenceLocation[];
  intensity: EvidenceIntensity | null;
  qualities: EvidenceMark[];
  onset: EvidenceMark | null;
  activity: string;
}

export interface RawPainExtraction {
  spokenLocation: string;
  region: string;
  side: "left" | "right" | "both" | "unspecified";
  qualities: string[];
  intensity: number | null;
  onsetPhrase: string;
  activity: string;
  surface: string;
  evidence?: EvidenceExtraction;
}

export const EXTRACTION_TIMEOUT_MS = 20000;

// Thrown when the caller cancels an extraction. The panel ignores it; a
// timeout is a plain Error with a message the person can read.
export class ExtractionCancelled extends Error {
  constructor() {
    super(t("native.ai-cancelled"));
    this.name = "ExtractionCancelled";
  }
}

export interface OnDeviceAI {
  // Checking availability never downloads a model or asks for permission.
  // The language decides which locale the model must support.
  isAvailable(language?: Language): Promise<OnDeviceAIAvailability>;
  // Stops after timeoutMs (default 20 s) or when signal aborts, and asks the
  // native side to cancel so the next request starts cleanly.
  extractPainEntry(
    options: {
      transcript: string;
      anatomyList: string[];
      today: string;
      language?: Language;
    },
    control?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<RawPainExtraction>;
  cancel(): Promise<void>;
  speak(text: string, language?: Language): Promise<void>;
  stopSpeaking(): Promise<void>;
}

export interface AppleIntelligenceBridge {
  isAvailable(options?: {
    language: Language;
    locale: string;
  }): Promise<OnDeviceAIAvailability>;
  extractPainEntry(options: {
    transcript: string;
    anatomyList: string[];
    today: string;
    language?: Language;
    locale?: string;
  }): Promise<unknown>;
  cancelExtraction(): Promise<void>;
  speak(options: { text: string; locale?: string }): Promise<unknown>;
  stopSpeaking(): Promise<void>;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const kinds = new Set(["rating", "duration", "count", "other"]);

const flag = (value: unknown) =>
  value === true ? true : value === false ? false : null;

function parseEvidence(raw: Record<string, unknown>): EvidenceExtraction {
  const locations: EvidenceLocation[] = [];
  if (Array.isArray(raw.locations)) {
    for (const item of raw.locations) {
      if (locations.length >= 2 || !item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const evidence = text(row.evidence, 120);
      const negated = flag(row.negated);
      if (!evidence || negated === null) continue;
      locations.push({
        evidence,
        negated,
        sideEvidence: text(row.sideEvidence, 40),
      });
    }
  }
  let intensity: EvidenceIntensity | null = null;
  if (raw.intensity && typeof raw.intensity === "object") {
    const row = raw.intensity as Record<string, unknown>;
    const evidence = text(row.evidence, 80);
    const negated = flag(row.negated);
    const kindName =
      typeof row.kind === "string" ? row.kind.trim().toLowerCase() : "";
    const value =
      typeof row.value === "number" &&
      Number.isInteger(row.value) &&
      row.value >= -1 &&
      row.value <= 10
        ? row.value
        : -1;
    if (negated !== null && (evidence || value >= 0))
      intensity = {
        evidence,
        value,
        kind: kinds.has(kindName)
          ? (kindName as EvidenceIntensity["kind"])
          : "other",
        negated,
      };
  }
  const qualities: EvidenceMark[] = [];
  if (Array.isArray(raw.qualities)) {
    for (const item of raw.qualities) {
      if (qualities.length >= 5 || !item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const evidence = text(row.evidence, 40);
      const negated = flag(row.negated);
      if (!evidence || negated === null) continue;
      qualities.push({ evidence, negated });
    }
  }
  let onset: EvidenceMark | null = null;
  if (raw.onset && typeof raw.onset === "object") {
    const row = raw.onset as Record<string, unknown>;
    const evidence = text(row.evidence, 80);
    const negated = flag(row.negated);
    if (evidence && negated !== null) onset = { evidence, negated };
  }
  return {
    locations,
    intensity,
    qualities,
    onset,
    activity: text(raw.activity, 80),
  };
}

export function parseRawExtraction(value: unknown): RawPainExtraction {
  if (!value || typeof value !== "object")
    throw new Error(t("native.ai-no-fields"));
  const raw = value as Record<string, unknown>;
  if (raw.schema === "v2" || Array.isArray(raw.locations)) {
    return {
      spokenLocation: "",
      region: "",
      side: "unspecified",
      qualities: [],
      intensity: null,
      onsetPhrase: "",
      activity: "",
      surface: "",
      evidence: parseEvidence(raw),
    };
  }
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
  const cancel = () => bridge.cancelExtraction().catch(() => {});
  return {
    async isAvailable(lang = currentLanguage()) {
      try {
        const state = await bridge.isAvailable({
          language: lang,
          locale: speechLocale(lang),
        });
        if (state.available === true) return { available: true };
        return {
          available: false,
          code: state.code,
          reason: nativeMessage(state.code, state.reason) ?? state.reason,
        };
      } catch {
        return { available: false };
      }
    },
    async extractPainEntry(options, control = {}) {
      const { signal, timeoutMs = EXTRACTION_TIMEOUT_MS } = control;
      if (signal?.aborted) throw new ExtractionCancelled();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort = () => {};
      const stopped = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void cancel();
          reject(new Error(t("native.ai-timeout")));
        }, timeoutMs);
        onAbort = () => {
          void cancel();
          reject(new ExtractionCancelled());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      const lang = options.language ?? currentLanguage();
      const pending = bridge.extractPainEntry({
        ...options,
        language: lang,
        locale: speechLocale(lang),
      });
      // After a timeout or cancel nobody awaits the native call. Its late
      // rejection is swallowed explicitly so it can never surface as
      // unhandled, even if the race below is refactored away.
      pending.catch(() => {});
      try {
        let value: unknown;
        try {
          value = await Promise.race([pending, stopped]);
        } catch (error) {
          if (error instanceof ExtractionCancelled) throw error;
          if (
            error instanceof Error &&
            error.message === t("native.ai-timeout")
          )
            throw error;
          throw nativeError(error, t("native.ai-failed"));
        }
        return parseRawExtraction(value);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    cancel,
    async speak(value, lang = currentLanguage()) {
      await bridge.speak({
        text: value.slice(0, 300),
        locale: speechLocale(lang),
      });
    },
    stopSpeaking: () => bridge.stopSpeaking(),
  };
}

let ai: OnDeviceAI | undefined;

export function configureOnDeviceAI(adapter: OnDeviceAI) {
  ai = adapter;
}

export const onDeviceAI = () => ai;
