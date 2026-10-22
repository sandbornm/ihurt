export interface SpeechAvailability {
  available: boolean;
  reason?: string;
}

export interface NativeSpeech {
  // Checking availability must not request microphone or speech permission.
  availability(): Promise<SpeechAvailability>;
  // Each callback replaces the transcript for this recording session. onEnd
  // carries the final transcript when recognition finishes without an error.
  start(
    onText: (text: string) => void,
    onEnd?: (error?: string, text?: string) => void,
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
