export interface SpeechAvailability {
  available: boolean;
  reason?: string;
}

export interface NativeSpeech {
  // Checking availability must not request microphone or speech permission.
  availability(): Promise<SpeechAvailability>;
  // Each callback replaces the transcript for this recording session.
  start(onText: (text: string) => void): Promise<void>;
  // Resolve after delivering any final transcript and releasing the microphone.
  stop(): Promise<void>;
  // Discard pending callbacks and release the microphone.
  cancel(): Promise<void>;
}

let speech: NativeSpeech | undefined;

export function configureNativeSpeech(adapter: NativeSpeech) {
  speech = adapter;
}

export const nativeSpeech = () => speech;
