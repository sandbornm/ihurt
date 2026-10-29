export interface SpeechAvailability {
  available: boolean;
  reason?: string;
  code?: string;
}

export interface NativeSpeech {
  availability(locale?: string): Promise<SpeechAvailability>;
  start(
    onText: (text: string) => void,
    onEnd?: (error?: string, text?: string) => void,
    locale?: string,
  ): Promise<void>;
  stop(): Promise<string | undefined>;
  cancel(): Promise<void>;
}

let speech: NativeSpeech | undefined;

export function configureNativeSpeech(adapter: NativeSpeech) {
  speech = adapter;
}

export const nativeSpeech = () => speech;
