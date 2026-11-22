export interface SpeechAvailability {
  available: boolean;
  reason?: string;
  // Stable reason from the native side, translated by native-messages.ts.
  code?: string;
}

export interface NativeSpeech {
  // Checking availability must not request microphone or speech permission.
  // locale is a BCP 47 tag such as es-MX; omitted means the device language.
  availability(locale?: string): Promise<SpeechAvailability>;
  // Each callback replaces the transcript for this recording session. onEnd
  // carries the final transcript when recognition finishes without an error.
  start(
    onText: (text: string) => void,
    onEnd?: (error?: string, text?: string) => void,
    locale?: string,
  ): Promise<void>;
  // Resolve with the final transcript after delivering it and releasing the
  // microphone. Resolves undefined when there is no active recording.
  stop(): Promise<string | undefined>;
  // Discard pending callbacks and release the microphone.
  cancel(): Promise<void>;
}

let speech: NativeSpeech | undefined;

export function configureNativeSpeech(adapter: NativeSpeech) {
  speech = adapter;
}

export const nativeSpeech = () => speech;
