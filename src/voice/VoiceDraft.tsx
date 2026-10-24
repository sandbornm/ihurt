import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { nativeSpeech } from "../platform/speech";
import { ExtractionCancelled, onDeviceAI } from "../platform/on-device-ai";
import { isNativeApp } from "../platform/files";
import { regionName, type SavedMap } from "../types";
import { useI18n } from "../i18n/react";
import { formatNumber, speechLocale, type MessageKey } from "../i18n";
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
  // Kept so reopening shows the same suggestion; it is used only while its
  // transcript still matches the text, and the pin still needs "Add to entry".
  proposal?: PainProposal | null;
  pin?: boolean;
}

export default function VoiceDraft(
  props: VoiceDraftProps & { client: VoiceClient },
) {
  return <EntryVoiceDraft key={props.entry.id} {...props} />;
}

function EntryVoiceDraft(props: VoiceDraftProps & { client: VoiceClient }) {
  const { t } = useI18n();
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
        {draft?.text.trim() ? t("voice.reviewDraft") : t("voice.use")}
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
  const { t, lang } = useI18n();
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
  const [aiNotice, setAiNotice] = useState("");
  // The proposal stays in this panel's state. It is not autosaved and nothing
  // from it reaches the entry until "Add to entry".
  const [proposal, setProposal] = useState<PainProposal | null>(
    draft?.proposal ?? null,
  );
  const [extracting, setExtracting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [pin, setPin] = useState(draft?.pin ?? true);
  const extraction = useRef(0);
  const extractAbort = useRef<AbortController | null>(null);
  const gate = useRef(createAvailabilityGate()).current;
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
    // Closing the panel stops the on-device read and any spoken question now,
    // not only when the editor unmounts.
    cancelCapture();
    close({
      text: busy ? previousText.current : text,
      fields,
      region,
      proposal,
      pin,
    });
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
      const state = await speech.availability(speechLocale(lang));
      if (!active) return;
      setAvailable(state.available);
      setError(
        state.available
          ? ""
          : (state.reason ?? t("voice.error.speechUnavailable")),
      );
    };
    const checkAi = () =>
      ai!
        .isAvailable(lang)
        .then((state) => {
          if (!active) return;
          const queued = gate.recheck(state.available);
          setAiReady(state.available);
          if (queued) void runExtraction(queued);
          // Dictation still works when the model does not support the
          // language. Say so instead of hiding the suggestions silently.
          setAiNotice(
            !state.available && state.code === "ai-locale-unsupported"
              ? (state.reason ?? "")
              : "",
          );
        })
        .catch(() => {
          if (!active) return;
          gate.recheck(false);
          setAiReady(false);
        });
    if (ai && native) void checkAi();
    else gate.settle(false);
    void (async () => {
      try {
        if (speech) {
          await checkNative();
        } else if (native) {
          if (active) setError(t("voice.error.speechMissing"));
        } else {
          const next = await client.session();
          if (!active) return;
          setSession(next);
          setAvailable(next.transcription_available);
        }
      } catch {
        if (active) setError(t("voice.error.transcriptionUnavailable"));
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
        setError(t("voice.error.leftScreen"));
      } else if (document.visibilityState === "visible") {
        // Settings may have changed while the app was away.
        if (speech)
          void checkNative().catch(() => {
            if (active) setAvailable(false);
          });
        if (ai && native) void checkAi();
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
          speechLocale(lang),
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
        setError(t("voice.error.couldNotStart"));
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
            : t("voice.error.transcriptionStopped"),
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
        { transcript: value, anatomyList, today, language: lang },
        { signal: controller.signal },
      );
      if (extraction.current !== current) return;
      const next = buildProposal(raw, value, today, lang);
      setProposal(next);
      setFields((old) => seedSuggestedFields(old, {}, next.fields, entry.map));
      setPin(next.location.status === "mapped");
      if (next.followUp)
        void ai.speak(next.followUp.question, lang).catch(() => {});
    } catch (caught) {
      if (caught instanceof ExtractionCancelled) return;
      if (extraction.current === current)
        setError(
          caught instanceof Error ? caught.message : t("voice.error.aiFailed"),
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
          caught instanceof Error ? caught.message : t("voice.error.notAdded"),
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
        caught instanceof Error ? caught.message : t("voice.error.notAdded"),
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
        <h2 id="voice-title">{t("voice.title")}</h2>
        <button type="button" onClick={dismiss} aria-label={t("voice.close")}>
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
          {t("voice.privacy")}
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
            {native ? t("voice.stop") : t("voice.stopTranscribe")} · {seconds} s
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
              ? t("voice.checking")
              : mode === "starting"
                ? t("voice.opening")
                : mode === "processing"
                  ? t("voice.transcribing")
                  : text
                    ? t("voice.recordAgain")
                    : t("voice.record")}
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
            {mode === "processing"
              ? t("voice.discardResult")
              : t("voice.cancelRecording")}
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
      <label htmlFor="voice-transcript">{t("voice.reviewTranscript")}</label>
      <textarea
        id="voice-transcript"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        maxLength={3000}
        rows={5}
        placeholder={t("voice.placeholder")}
      />
      {aiReady && (extracting || live || text.trim()) && (
        <section className="voice-proposal" aria-live="polite">
          <h3>{t("voice.suggested")}</h3>
          {extracting ? (
            <p>{t("voice.reading")}</p>
          ) : live ? (
            <>
              <p>{describeLocation(live.location, lang)}</p>
              {liveRegion && (
                <label className="voice-field">
                  <input
                    type="checkbox"
                    checked={pin}
                    onChange={(event) => setPin(event.target.checked)}
                  />{" "}
                  <span>
                    {t("voice.proposePin", { region: regionName(liveRegion) })}
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
                      {t("voice.answer")}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => submitAnswer(true)}
                    >
                      {t("voice.skip")}
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
              {t("voice.suggestFields")}
            </button>
          )}
          <p className="subtle">{t("voice.runsHere")}</p>
        </section>
      )}
      {Object.keys(shownFields).length > 0 && (
        <fieldset>
          <legend>{t("voice.fillFields")}</legend>
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
                {t(`voice.field.${key}` as MessageKey)}:{" "}
                {typeof value === "number"
                  ? formatNumber(value)
                  : String(value)}
                {key === "intensity" ? " / 10" : ""}
                {entry.map[key as keyof DraftFields]
                  ? ` · ${t("voice.replaces")}`
                  : ""}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {!live && suggestions.locations.length > 0 && (
        <label>
          {t("voice.locateArea")}
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            <option value="">{t("voice.keepView")}</option>
            {suggestions.locations.map((id) => (
              <option key={id} value={id}>
                {regionName(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="subtle">{t("voice.appends")}</p>
      <p className="subtle">{t("voice.closingKeeps")}</p>
      {aiNotice && <p className="subtle">{aiNotice}</p>}
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
        {t("voice.addToEntry")}
      </button>
      <button
        type="button"
        className="text-button voice-discard"
        disabled={busy || !text.trim()}
        onClick={() => close()}
      >
        {t("voice.discardDraft")}
      </button>
    </dialog>
  );
}
