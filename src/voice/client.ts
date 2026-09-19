import { api } from "../api";

export interface VoiceSession {
  transcription_available: boolean;
  transcription_provider: "ElevenLabs" | "OpenAI" | null;
  max_audio_seconds: number;
  turnstile_site_key: string;
}
export interface VoiceClient {
  session(): Promise<VoiceSession>;
  transcribe(
    audio: Blob,
    challenge: string,
    signal: AbortSignal,
  ): Promise<string>;
}
export const localVoiceClient: VoiceClient = {
  session: () => api<VoiceSession>("session"),
  async transcribe(audio, challenge, signal) {
    const form = new FormData();
    form.append("audio", audio, "note.wav");
    form.append("consent", "true");
    form.append("request_id", crypto.randomUUID());
    form.append("challenge_token", challenge);
    const response = await api<{ text: string }>("transcribe", form, signal);
    if (
      typeof response.text !== "string" ||
      response.text.length > 3000 ||
      !response.text.trim()
    )
      throw new Error(
        "No usable transcript was returned. Try again or type below.",
      );
    return response.text;
  },
};
