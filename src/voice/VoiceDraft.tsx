import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { nativeSpeech } from "../platform/speech";
import { ExtractionCancelled, onDeviceAI } from "../platform/on-device-ai";
import { isNativeApp } from "../platform/files";
import { regionName, type SavedMap } from "../types";
import VisitorCheck from "../VisitorCheck";
import type { VoiceClient, VoiceSession } from "./client";
import {
  suggestVoiceDraft,
  voiceNotice,
  type DraftFields,
  type VoiceDraftValue,
} from "./draft";
import {
  anatomyList,
  answerFollowUp,
  buildProposal,
  confirmProposal,
  describeLocation,
  localToday,
  proposedRegion,
  seedSuggestedFields,
  type PainProposal,
} from "./extraction";
import { createAvailabilityGate } from "./ai-gate";
import { startRecording, toWav, type Recording } from "./recording";
import { createSuggestOnce } from "./suggest-once";
import "./voice.css";

export interface VoiceDraftProps {
  entry: SavedMap;
  onApply(value: VoiceDraftValue): void;
}

interface ReviewDraft {
  text: string;
  fields: Record<string, boolean>;
  region: string;
}

export default function VoiceDraft(
  props: VoiceDraftProps & { client: VoiceClient },
) {
  return <EntryVoiceDraft key={props.entry.id} {...props} />;
}

function EntryVoiceDraft(props: VoiceDraftProps & { client: VoiceClient }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft>();
  return (
    <>
      <button
        className="text-button"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Mic size={15} />{" "}
        {draft?.text.trim() ? "Review voice draft" : "Use voice"}
      </button>
      {open && (
        <VoiceEditor
          key={props.entry.id}
          {...props}
          draft={draft}
          close={(pending) => {
            setDraft(pending);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function VoiceEditor({
  entry,
  onApply,
  close,
  client,
  draft,
}: VoiceDraftProps & {
  client: VoiceClient;
  draft?: ReviewDraft;
  close(pending?: ReviewDraft): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(draft?.text ?? "");
  const [mode, setMode] = useState<
    "loading" | "idle" | "starting" | "recording" | "processing"
  >("loading");
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [challenge, setChallenge] = useState("");
  const [nonce, setNonce] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [region, setRegion] = useState(draft?.region ?? "");
  const [fields, setFields] = useState<Record<string, boolean>>(
    draft?.fields ?? {
      intensity: entry.map.intensity === null,
      quality: !entry.map.quality,
      activity: !entry.map.activity,
      duration: !entry.map.duration,
    },
  );
  const speech = useRef(nativeSpeech()).current;
  const ai = useRef(onDeviceAI()).current;
  const [aiReady, setAiReady] = useState(false);
  // The proposal stays in this panel's state. It is not autosaved and nothing
  // from it reaches the entry until "Add to entry".
  const [proposal, setProposal] = useState<PainProposal | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [pin, setPin] = useState(true);
  const extraction = useRef(0);
  const extractAbort = useRef<AbortController | null>(null);
  const gate = useRef(createAvailabilityGate()).current;
  const textRef = useRef(text);
  textRef.current = text;
  const recording = useRef<Recording | null>(null);
  const upload = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const suggestOnce = useRef(createSuggestOnce()).current;
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
  const live =
    proposal && proposal.transcript === text.trim() ? proposal : null;
  const shownFields = live ? live.fields : suggestions.fields;
  const liveRegion = live ? proposedRegion(live) : null;
  const busy = ["starting", "recording", "processing"].includes(mode);

  function dismiss() {
    close({ text: busy ? previousText.current : text, fields, region });
  }

  function cancelCapture() {
    generation.current++;
    recording.current?.cancel();
    recording.current = null;
    upload.current?.abort();
    upload.current = null;
    void speech?.cancel().catch(() => {});
    stopExtraction();
    void ai?.stopSpeaking().catch(() => {});
  }

  function stopExtraction() {
    extraction.current++;
    extractAbort.current?.abort();
    extractAbort.current = null;
    gate.clear();
    setExtracting(false);
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
    const settle = (ready: boolean) => {
      if (!active) return;
      setAiReady(ready);
      // A recording that finished during the check is read now. Recording
      // again or cancelling clears the queue, so the value is still current.
      const queued = gate.settle(ready);
      if (queued) void runExtraction(queued);
    };
    if (ai && native)
      void ai
        .isAvailable()
        .then((state) => settle(state.available))
        .catch(() => settle(false));
    else gate.settle(false);
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
    stopExtraction();
    setProposal(null);
    void ai?.stopSpeaking().catch(() => {});
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
          (message, final) => {
            ended = true;
            if (generation.current !== current) return;
            setMode("idle");
            if (message) setError(message);
            else if (final !== undefined) suggestFinal(current, final);
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
    let final: string | undefined;
    try {
      if (speech) final = await speech.stop();
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
        if (speech && final !== undefined) suggestFinal(current, final);
      }
    }
  }

  // Suggest once per recording, from the recognizer's final transcript rather
  // than the text box, which may not have rendered the last words yet.
  function suggestFinal(current: number, final: string) {
    const value = suggestOnce.deliver(current, generation.current, final);
    if (value) propose(value);
  }

  function propose(transcript: string) {
    const value = transcript.trim();
    if (!ai || !value) return;
    const now = gate.request(value);
    if (now) void runExtraction(now);
  }

  async function runExtraction(value: string) {
    if (!ai) return;
    extractAbort.current?.abort();
    const controller = new AbortController();
    extractAbort.current = controller;
    const current = ++extraction.current;
    setExtracting(true);
    setProposal(null);
    setAnswer("");
    try {
      const today = localToday();
      const raw = await ai.extractPainEntry(
        { transcript: value, anatomyList, today },
        { signal: controller.signal },
      );
      if (extraction.current !== current) return;
      const next = buildProposal(raw, value, today);
      setProposal(next);
      setFields((old) => seedSuggestedFields(old, {}, next.fields, entry.map));
      setPin(next.location.status === "mapped");
      if (next.followUp) void ai.speak(next.followUp.question).catch(() => {});
    } catch (caught) {
      if (caught instanceof ExtractionCancelled) return;
      if (extraction.current === current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Apple Intelligence could not read this note. You can still add it as text.",
        );
    } finally {
      if (extraction.current === current) {
        setExtracting(false);
        extractAbort.current = null;
      }
    }
  }

  function submitAnswer(skip = false) {
    if (!live) return;
    void ai?.stopSpeaking().catch(() => {});
    const next = answerFollowUp(live, skip ? "" : answer);
    setProposal(next);
    setFields((old) =>
      seedSuggestedFields(old, live.fields, next.fields, entry.map),
    );
    setText(next.transcript);
    setAnswer("");
    setPin(next.location.status === "mapped");
  }
  stopLatest.current = () => {
    void stop();
  };

  function apply() {
    if (live) {
      try {
        // "Add to entry" is the explicit confirmation of the proposal.
        onApply(confirmProposal(live, { confirmed: true, fields, pin }));
        void ai?.stopSpeaking().catch(() => {});
        close();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The draft could not be added.",
        );
      }
      return;
    }
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
        dismiss();
      }}
    >
      <div className="voice-heading">
        <h2 id="voice-title">Speak, then review</h2>
        <button type="button" onClick={dismiss} aria-label="Close voice draft">
          <X size={18} />
        </button>
      </div>
      <p>
        {voiceNotice({
          native,
          checking: mode === "loading",
          provider: session?.transcription_provider,
          available,
          maxSeconds,
        })}
      </p>
      {!native && available && session?.transcription_provider && (
        <a
          href={
            session.transcription_provider === "OpenAI"
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
            {mode === "processing" ? "Discard result" : "Cancel recording"}
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
      {aiReady && (extracting || live || text.trim()) && (
        <section className="voice-proposal" aria-live="polite">
          <h3>Suggested from your words</h3>
          {extracting ? (
            <p>Reading your note on this device…</p>
          ) : live ? (
            <>
              <p>{describeLocation(live.location)}</p>
              {liveRegion && (
                <label className="voice-field">
                  <input
                    type="checkbox"
                    checked={pin}
                    onChange={(event) => setPin(event.target.checked)}
                  />{" "}
                  <span>
                    Propose a pin on {regionName(liveRegion)}. You confirm it on
                    the body.
                  </span>
                </label>
              )}
              {live.followUp && !live.asked && (
                <div className="voice-follow-up">
                  <label htmlFor="voice-follow-up">
                    {live.followUp.question}
                  </label>
                  <input
                    id="voice-follow-up"
                    value={answer}
                    maxLength={300}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && answer.trim()) {
                        event.preventDefault();
                        submitAnswer();
                      }
                    }}
                  />
                  <div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!answer.trim()}
                      onClick={() => submitAnswer()}
                    >
                      Answer
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => submitAnswer(true)}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={busy || !text.trim()}
              onClick={() => propose(text)}
            >
              Suggest fields
            </button>
          )}
          <p className="subtle">
            Runs on this device. It uses only what you said and saves nothing
            until you add it.
          </p>
        </section>
      )}
      {Object.keys(shownFields).length > 0 && (
        <fieldset>
          <legend>Fill these fields</legend>
          {Object.entries(shownFields).map(([key, value]) => (
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
      {!live && suggestions.locations.length > 0 && (
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
      <p className="subtle">
        Closing this panel keeps your draft while you stay in this view. Add it
        to your entry to save it.
      </p>
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={!text.trim() || busy || extracting}
        onClick={apply}
      >
        Add to entry
      </button>
      <button
        type="button"
        className="text-button voice-discard"
        disabled={busy || !text.trim()}
        onClick={() => close()}
      >
        Discard draft
      </button>
    </dialog>
  );
}
