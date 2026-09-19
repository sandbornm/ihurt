import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { nativeSpeech } from "../platform/speech";
import { isNativeApp } from "../platform/files";
import { regionName, type SavedMap } from "../types";
import VisitorCheck from "../VisitorCheck";
import {
  localVoiceClient,
  type VoiceClient,
  type VoiceSession,
} from "./client";
import {
  suggestVoiceDraft,
  type DraftFields,
  type VoiceDraftValue,
} from "./draft";
import { startRecording, toWav, type Recording } from "./recording";
import "./voice.css";

export interface VoiceDraftProps {
  entry: SavedMap;
  onApply(value: VoiceDraftValue): void;
}

export default function VoiceDraft(
  props: VoiceDraftProps & { client?: VoiceClient },
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="text-button"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Mic size={15} /> Use voice
      </button>
      {open && (
        <VoiceEditor
          key={props.entry.id}
          {...props}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function VoiceEditor({
  entry,
  onApply,
  close,
  client = localVoiceClient,
}: VoiceDraftProps & { client?: VoiceClient; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<
    "loading" | "idle" | "starting" | "recording" | "processing"
  >("loading");
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [challenge, setChallenge] = useState("");
  const [nonce, setNonce] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [region, setRegion] = useState("");
  const [fields, setFields] = useState<Record<string, boolean>>({
    intensity: entry.map.intensity === null,
    quality: !entry.map.quality,
    activity: !entry.map.activity,
    duration: !entry.map.duration,
  });
  const speech = useRef(nativeSpeech()).current;
  const recording = useRef<Recording | null>(null);
  const upload = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const stopLatest = useRef(() => {});
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const previousText = useRef("");
  const native = isNativeApp();
  const maxSeconds = Math.min(
    60,
    Math.max(1, session?.max_audio_seconds ?? 60),
  );
  const suggestions = useMemo(() => suggestVoiceDraft(text), [text]);
  const busy = ["starting", "recording", "processing"].includes(mode);

  function cancelCapture() {
    generation.current++;
    recording.current?.cancel();
    recording.current = null;
    upload.current?.abort();
    upload.current = null;
    void speech?.cancel().catch(() => {});
  }
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    const checkNative = async () => {
      if (!speech) return;
      const state = await speech.availability();
      if (!active) return;
      setAvailable(state.available);
      setError(
        state.available
          ? ""
          : (state.reason ??
              "On-device speech is unavailable. Type or paste a transcript below."),
      );
    };
    void (async () => {
      try {
        if (speech) {
          await checkNative();
        } else if (native) {
          if (active)
            setError(
              "On-device speech is unavailable in this build. Type or paste a transcript below.",
            );
        } else {
          const next = await client.session();
          if (!active) return;
          setSession(next);
          setAvailable(next.transcription_available);
          if (!next.transcription_available)
            setError(
              "Voice transcription is not configured. Type or paste a transcript below.",
            );
        }
      } catch {
        if (active)
          setError(
            "Voice transcription is unavailable. Type or paste a transcript below.",
          );
      } finally {
        if (active) setMode("idle");
      }
    })();
    const hide = () => {
      if (
        document.visibilityState === "hidden" &&
        ["starting", "recording", "processing"].includes(modeRef.current)
      ) {
        cancelCapture();
        setMode("idle");
        setError(
          "Recording stopped when the app left the screen. Review the transcript before adding it.",
        );
      } else if (document.visibilityState === "visible" && speech) {
        void checkNative().catch(() => {
          if (active) setAvailable(false);
        });
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      active = false;
      cancelCapture();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (mode !== "recording") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);

  async function record() {
    if (!available || busy) return;
    const current = ++generation.current;
    previousText.current = text;
    setError("");
    setSeconds(0);
    setMode("starting");
    try {
      if (speech) {
        let ended = false;
        await speech.start(
          (value) => {
            if (generation.current === current) setText(value.slice(0, 3000));
          },
          (message) => {
            ended = true;
            if (generation.current !== current) return;
            setMode("idle");
            if (message) setError(message);
          },
        );
        if (!ended && generation.current === current) setMode("recording");
      } else {
        const capture = await startRecording(
          () => stopLatest.current(),
          maxSeconds,
          (message) => {
            if (generation.current !== current) return;
            recording.current = null;
            setMode("idle");
            setError(message);
          },
        );
        if (generation.current !== current) {
          capture.cancel();
          return;
        }
        recording.current = capture;
        setMode("recording");
      }
    } catch {
      if (generation.current === current) {
        setMode("idle");
        setError(
          "Recording could not start. Check microphone and speech permissions, or type below.",
        );
      }
    }
  }

  async function stop() {
    if (mode !== "recording") return;
    const current = generation.current;
    setMode("processing");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (speech) await speech.stop();
      else if (recording.current) {
        const capture = recording.current;
        const blob = await capture.stop();
        if (generation.current !== current) return;
        const audio = await toWav(blob, maxSeconds);
        if (generation.current !== current) return;
        const controller = new AbortController();
        upload.current = controller;
        timeout = setTimeout(() => controller.abort(), 60000);
        const value = await client.transcribe(
          audio,
          challenge,
          controller.signal,
        );
        if (generation.current === current) setText(value);
      }
    } catch (caught) {
      if (generation.current === current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Transcription stopped. Try again or type below.",
        );
    } finally {
      clearTimeout(timeout);
      if (generation.current === current) {
        recording.current = null;
        upload.current = null;
        setMode("idle");
        setChallenge("");
        setNonce((value) => value + 1);
      }
    }
  }
  stopLatest.current = () => {
    void stop();
  };

  function apply() {
    const chosen: DraftFields = {};
    for (const key of Object.keys(suggestions.fields) as (keyof DraftFields)[])
      if (fields[key])
        Object.assign(chosen, { [key]: suggestions.fields[key] });
    try {
      onApply({
        text,
        fields: chosen,
        ...(suggestions.locations.includes(region) ? { region } : {}),
      });
      close();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The draft could not be added.",
      );
    }
  }

  return (
    <dialog
      ref={dialog}
      className="voice-dialog"
      aria-labelledby="voice-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="voice-heading">
        <h2 id="voice-title">Speak, then review</h2>
        <button type="button" onClick={close} aria-label="Close voice draft">
          <X size={18} />
        </button>
      </div>
      <p>
        {native
          ? "Apple speech recognition runs on your device. Review the words before adding them."
          : `Stopping or reaching the ${maxSeconds}-second limit sends audio to ${session?.transcription_provider ?? "ElevenLabs"}. Its retention policy applies.`}
      </p>
      {!native && (
        <a
          href={
            session?.transcription_provider === "OpenAI"
              ? "https://openai.com/policies/privacy-policy/"
              : "https://elevenlabs.io/privacy-policy"
          }
          target="_blank"
          rel="noreferrer"
        >
          Transcription privacy ↗
        </a>
      )}
      <div className="voice-actions">
        {mode === "recording" ? (
          <button
            type="button"
            className="secondary recording"
            onClick={() => void stop()}
          >
            <Square size={14} />
            {native ? "Stop" : "Stop & transcribe"} · {seconds}s
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => void record()}
            disabled={
              !available ||
              mode !== "idle" ||
              (!!session?.turnstile_site_key && !challenge)
            }
          >
            <Mic size={15} />
            {mode === "loading"
              ? "Checking speech…"
              : mode === "starting"
                ? "Opening microphone…"
                : mode === "processing"
                  ? "Transcribing…"
                  : text
                    ? "Record again"
                    : "Record"}
          </button>
        )}
        {busy && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              cancelCapture();
              setMode("idle");
              setText(previousText.current);
              setError("");
            }}
          >
            Cancel recording
          </button>
        )}
      </div>
      {!native && session?.turnstile_site_key && (
        <VisitorCheck
          siteKey={session.turnstile_site_key}
          nonce={nonce}
          onToken={setChallenge}
        />
      )}
      <label htmlFor="voice-transcript">Review transcript</label>
      <textarea
        id="voice-transcript"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        maxLength={3000}
        rows={5}
        placeholder="My left calf feels tight, four out of ten. Activity: running. Duration: since yesterday."
      />
      {Object.keys(suggestions.fields).length > 0 && (
        <fieldset>
          <legend>Fill these fields</legend>
          {Object.entries(suggestions.fields).map(([key, value]) => (
            <label className="voice-field" key={key}>
              <input
                type="checkbox"
                checked={!!fields[key]}
                onChange={(event) =>
                  setFields((old) => ({ ...old, [key]: event.target.checked }))
                }
              />{" "}
              <span>
                {key}: {String(value)}
                {key === "intensity" ? " / 10" : ""}
                {entry.map[key as keyof DraftFields]
                  ? " · replaces existing value"
                  : ""}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {suggestions.locations.length > 0 && (
        <label>
          Locate an area after adding the note
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            <option value="">Keep the current view</option>
            {suggestions.locations.map((id) => (
              <option key={id} value={id}>
                {regionName(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="subtle">
        The transcript appends to your note. Choose the exact surface on the
        body to add a pin.
      </p>
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={!text.trim() || busy}
        onClick={apply}
      >
        Add to entry
      </button>
    </dialog>
  );
}
