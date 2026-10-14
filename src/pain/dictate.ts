import { isNativeApp } from "../platform/files.ts";
import { nativeSpeech, type NativeSpeech } from "../platform/speech.ts";

export type SpeechKind = "apple" | "web" | "upload" | "none";

export function chooseSpeech(
  native: boolean,
  web: boolean,
  nativeApp: boolean,
  recorder: boolean,
): SpeechKind {
  if (native) return "apple";
  if (web) return "web";
  if (nativeApp) return "none";
  return recorder ? "upload" : "none";
}

interface SpeechAlternative {
  transcript?: string;
}
interface SpeechResult {
  0?: SpeechAlternative;
}
interface SpeechEventLike {
  results: ArrayLike<SpeechResult>;
}
interface WebSpeech extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function webCtor() {
  if (typeof window === "undefined") return undefined;
  const host = window as Window & {
    SpeechRecognition?: new () => WebSpeech;
    webkitSpeechRecognition?: new () => WebSpeech;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}

export function speechKind(): SpeechKind {
  const recorder =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  return chooseSpeech(!!nativeSpeech(), !!webCtor(), isNativeApp(), recorder);
}

/** On-device Apple speech, or the browser Web Speech API. Upload is separate. */
export function liveSpeech(): NativeSpeech | null {
  const native = nativeSpeech();
  if (native) return native;
  const Ctor = webCtor();
  if (!Ctor) return null;
  let recognition: WebSpeech | undefined;
  let stopped = false;
  return {
    availability: async () => ({ available: true }),
    async start(onText, onEnd) {
      stopped = false;
      recognition = new Ctor();
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let text = "";
        for (let index = 0; index < event.results.length; index++)
          text += event.results[index]?.[0]?.transcript ?? "";
        onText(text);
      };
      recognition.onerror = (event) => {
        if (stopped || event.error === "aborted") return;
        onEnd?.(
          event.error === "not-allowed"
            ? "Microphone permission is blocked. You can type instead."
            : "Speech recognition stopped. You can type instead.",
        );
      };
      recognition.onend = () => {
        if (!stopped) onEnd?.();
      };
      recognition.start();
    },
    async stop() {
      stopped = true;
      recognition?.stop();
    },
    async cancel() {
      stopped = true;
      recognition?.abort();
    },
  };
}
