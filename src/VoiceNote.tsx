import { useEffect, useRef, useState } from "react";
import { Mic, Square, AudioLines, LoaderCircle } from "lucide-react";
import { api } from "./api";

interface Props {
  disabled: boolean;
  live: boolean;
  consent: boolean;
  maxSeconds: number;
  challengeToken: string;
  onText: (text: string) => void;
  onError: (text: string) => void;
  onConsumed: () => void;
}
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

async function toWav(blob: Blob, maxSeconds: number): Promise<Blob> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(
      1,
      Math.min(maxSeconds * 16000, Math.ceil(buffer.duration * 16000)),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const bytes = new ArrayBuffer(44 + pcm.length * 2),
      view = new DataView(bytes);
    const ascii = (offset: number, value: string) =>
      [...value].forEach((char, i) =>
        view.setUint8(offset + i, char.charCodeAt(0)),
      );
    ascii(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++)
      view.setInt16(
        44 + i * 2,
        Math.max(-1, Math.min(1, pcm[i])) * 32767,
        true,
      );
    return new Blob([bytes], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

export default function VoiceNote(p: Props) {
  const [mode, setMode] = useState<
    "idle" | "record" | "dictate" | "transcribe"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    recognition = useRef<Recognition | null>(null),
    mounted = useRef(true);
  const RecognitionClass =
    (
      window as unknown as {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      }
    ).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
      .webkitSpeechRecognition;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      recognition.current?.stop();
    };
  }, []);
  async function record() {
    if (mode === "record") {
      recorder.current?.stop();
      return;
    }
    if (!p.live) {
      p.onError(
        "Voice-note transcription needs an OpenAI API key on the server. You can type or use dictation in demo mode.",
      );
      return;
    }
    if (!p.consent) {
      p.onError("Agree to send the recording to OpenAI before recording.");
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Recording isn’t supported here. Use typing or device dictation.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const capture = new MediaRecorder(stream.current);
      recorder.current = capture;
      const chunks: BlobPart[] = [];
      let elapsed = 0;
      capture.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      capture.onstop = async () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        if (!mounted.current) return;
        setMode("transcribe");
        try {
          const audio = await toWav(
            new Blob(chunks, { type: capture.mimeType }),
            p.maxSeconds,
          );
          const form = new FormData();
          form.append("audio", audio, "note.wav");
          form.append("consent", "true");
          form.append("request_id", crypto.randomUUID());
          form.append("challenge_token", p.challengeToken);
          const result = await api<{ text: string }>("transcribe", form);
          if (mounted.current) p.onText(result.text);
        } catch (error) {
          if (mounted.current)
            p.onError(
              error instanceof Error
                ? error.message
                : "Transcription failed. Please type your note.",
            );
        } finally {
          p.onConsumed();
          if (mounted.current) setMode("idle");
        }
      };
      capture.start();
      setMode("record");
      setSeconds(0);
      timer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= p.maxSeconds) capture.stop();
      }, 1000);
    } catch (error) {
      stream.current?.getTracks().forEach((t) => t.stop());
      p.onError(
        error instanceof Error
          ? error.message
          : "Microphone access was denied. You can type instead.",
      );
      setMode("idle");
    }
  }
  function dictate() {
    if (mode === "dictate") {
      recognition.current?.stop();
      return;
    }
    if (!RecognitionClass) {
      p.onError(
        "This browser doesn’t support dictation. Try your device keyboard’s microphone.",
      );
      return;
    }
    const r = new RecognitionClass();
    recognition.current = r;
    r.lang = "en-US";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => p.onText(e.results[0][0].transcript);
    r.onerror = () => {
      p.onError(
        "Dictation stopped. Check microphone access or type your note.",
      );
      setMode("idle");
    };
    r.onend = () => setMode("idle");
    r.start();
    setMode("dictate");
  }
  return (
    <div className="voice-tools">
      <button
        type="button"
        className={mode === "record" ? "recording" : ""}
        disabled={p.disabled || mode === "transcribe" || mode === "dictate"}
        onClick={record}
        title="Record up to 60 seconds; transcription uses OpenAI"
      >
        {mode === "transcribe" ? (
          <LoaderCircle className="spin" size={15} />
        ) : mode === "record" ? (
          <Square size={14} />
        ) : (
          <Mic size={15} />
        )}{" "}
        {mode === "record"
          ? `Stop · ${seconds}s`
          : mode === "transcribe"
            ? "Transcribing…"
            : "Voice note"}
      </button>
      <button
        type="button"
        disabled={p.disabled || mode === "record" || mode === "transcribe"}
        onClick={dictate}
        title="Dictation may send audio to your browser’s speech provider"
      >
        <AudioLines size={16} />
        {mode === "dictate" ? "Stop dictation" : "Dictate"}
      </button>
    </div>
  );
}
