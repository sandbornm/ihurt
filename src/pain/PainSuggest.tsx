import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "../api.ts";
import { speechLocale } from "../i18n/index.ts";
import { useI18n } from "../i18n/react.ts";
import { isNativeApp } from "../platform/files.ts";
import type { RegionId, Session } from "../types.ts";
import VisitorCheck from "../VisitorCheck.tsx";
import { localVoiceClient } from "../voice/client.ts";
import { startRecording, toWav, type Recording } from "../voice/recording.ts";
import {
  painLevelKey,
  plainText,
  readSuggestion,
  sideKey,
  statedIntensity,
  suggestionIsCurrent,
  type PainSuggestion,
} from "./catalog.ts";
import { liveSpeech, speechKind } from "./dictate.ts";

export interface PainSuggestProps {
  onHighlight(regions: RegionId[]): void;
  onShow(region: RegionId): void;
  onAddPin(region: RegionId): void;
  onUseQuality(value: string): void;
  onUseIntensity(value: number): void;
  onUseActivity(value: string): void;
  onInsertText(value: string): void;
}

export default function PainSuggest(props: PainSuggestProps) {
  const { t, lang, locale } = useI18n();
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [recordConsent, setRecordConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<PainSuggestion | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [nonce, setNonce] = useState(0);
  const kind = speechKind();
  const generation = useRef(0);
  const suggestRun = useRef(0);
  const latestText = useRef("");
  latestText.current = text;
  const alive = useRef(true);
  const inflight = useRef<AbortController | null>(null);
  const capture = useRef<Recording | null>(null);
  const speech = useRef<ReturnType<typeof liveSpeech>>(null);
  const heard = useRef("");

  function reportSpeech(message?: string) {
    if (message === "mic-blocked") setError(t("pain.error.micBlocked"));
    else if (message === "speech-stopped") setError(t("pain.error.speechStopped"));
    else if (message) setError(message);
  }

  function clearSuggestion() {
    setResult(null);
    setSourceText("");
    props.onHighlight([]);
  }

  function updateDescription(value: string) {
    setText(value);
    suggestRun.current += 1;
    inflight.current?.abort();
    clearSuggestion();
    setStatus("");
    setBusy(false);
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      suggestRun.current += 1;
      inflight.current?.abort();
      capture.current?.cancel();
      void speech.current?.cancel().catch(() => {});
    };
  }, []);

  async function loadSession() {
    if (isNativeApp()) return null;
    try {
      const next = await api<Session>("session");
      if (!alive.current) return next;
      setSession(next);
      return next;
    } catch {
      return session;
    }
  }

  async function listen() {
    if (recording || busy) return;
    setError("");
    const current = ++generation.current;
    const localeTag = speechLocale(lang);
    if (kind === "apple" || kind === "web") {
      const dictator = liveSpeech(localeTag);
      speech.current = dictator;
      if (!dictator) {
        setError(t("pain.error.speechUnavailable"));
        return;
      }
      try {
        let ended = false;
        await dictator.start(
          (value) => {
            if (generation.current !== current || !alive.current) return;
            heard.current = value.slice(0, 3000);
            updateDescription(value.slice(0, 3000));
          },
          (message) => {
            ended = true;
            if (generation.current !== current || !alive.current) return;
            setRecording(false);
            reportSpeech(message);
          },
        );
        if (!ended && generation.current === current && alive.current) setRecording(true);
      } catch {
        if (generation.current === current && alive.current) {
          setRecording(false);
          setError(t("pain.error.speechStart"));
        }
      }
      return;
    }
    if (kind !== "upload") {
      setError(t("pain.error.speechUnavailable"));
      return;
    }
    const currentSession = session ?? (await loadSession());
    if (!alive.current || generation.current !== current) return;
    if (!currentSession?.transcription_available) {
      setError(t("pain.error.transcriptionOff"));
      return;
    }
    if (!recordConsent) {
      setError(t("pain.error.recordConsent"));
      return;
    }
    if (currentSession.turnstile_site_key && !token) {
      setError(t("pain.error.visitorMic"));
      return;
    }
    try {
      const next = await startRecording(
        () => {
          void finishRecording(current);
        },
        Math.min(60, currentSession.max_audio_seconds || 60),
        (message) => {
          if (generation.current !== current || !alive.current) return;
          capture.current = null;
          setRecording(false);
          setError(message);
        },
      );
      if (generation.current !== current || !alive.current) {
        next.cancel();
        return;
      }
      capture.current = next;
      setRecording(true);
    } catch {
      if (generation.current === current && alive.current)
        setError(t("pain.error.mic"));
    }
  }

  async function finishRecording(current = generation.current) {
    if (kind === "apple" || kind === "web") {
      setRecording(false);
      await speech.current?.stop().catch(() => {});
      if (heard.current && alive.current) updateDescription(heard.current.slice(0, 3000));
      return;
    }
    const pending = capture.current;
    if (!pending) return;
    setRecording(false);
    setBusy(true);
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const blob = await pending.stop();
      if (generation.current !== current || !alive.current) return;
      const audio = await toWav(
        blob,
        Math.min(60, session?.max_audio_seconds || 60),
      );
      const transcript = await localVoiceClient.transcribe(
        audio,
        token,
        controller.signal,
        lang,
      );
      if (generation.current === current && alive.current && !controller.signal.aborted)
        updateDescription(transcript.slice(0, 3000));
    } catch (caught) {
      if (generation.current === current && alive.current && !controller.signal.aborted)
        setError(
          caught instanceof Error ? caught.message : t("pain.error.transcribe"),
        );
    } finally {
      capture.current = null;
      if (generation.current === current && alive.current) {
        setBusy(false);
        setToken("");
        setNonce((value) => value + 1);
      }
    }
  }

  async function suggest() {
    if (busy) return;
    const description = plainText(text);
    if (description.length < 3) {
      setError(t("pain.error.short"));
      return;
    }
    if (isNativeApp()) {
      setError(t("pain.error.native"));
      return;
    }
    if (!consent) {
      setError(t("pain.error.consent"));
      return;
    }
    const run = ++suggestRun.current;
    const controller = new AbortController();
    inflight.current?.abort();
    inflight.current = controller;
    const currentNow = () =>
      suggestionIsCurrent({
        alive: alive.current,
        aborted: controller.signal.aborted,
        run,
        currentRun: suggestRun.current,
        sent: description,
        latest: plainText(latestText.current),
      });
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const current = (await loadSession()) ?? session;
      if (!currentNow()) return;
      if (!current?.pain_suggestions) {
        clearSuggestion();
        setStatus(t("pain.status.off"));
        return;
      }
      if (current.turnstile_site_key && !token) {
        setError(t("pain.error.visitor"));
        return;
      }
      const response = await api<{ suggestion: unknown }>(
        "pain",
        {
          request_id: crypto.randomUUID(),
          text: description,
          consent: true,
          challenge_token: token,
          language: lang,
        },
        controller.signal,
      );
      if (!currentNow()) return;
      if (response.suggestion == null) {
        clearSuggestion();
        setStatus(t("pain.status.off"));
        return;
      }
      const parsed = readSuggestion(response.suggestion);
      if (!currentNow()) return;
      if (!parsed) {
        clearSuggestion();
        setStatus(t("pain.status.unreadable"));
        return;
      }
      setResult(parsed);
      setSourceText(description);
      props.onHighlight([]);
      const namedSide = parsed.side && parsed.side.id !== "unspecified";
      const empty = !namedSide && !parsed.pain_level;
      setStatus(empty ? t("pain.status.empty") : "");
    } catch (caught) {
      if (!currentNow()) return;
      clearSuggestion();
      setError(
        caught instanceof Error ? caught.message : t("pain.error.request"),
      );
    } finally {
      if (alive.current && suggestRun.current === run) {
        setBusy(false);
        setToken("");
        setNonce((value) => value + 1);
      }
    }
  }

  const speechNote =
    kind === "apple"
      ? t("pain.speech.apple")
      : kind === "web"
        ? t("pain.speech.web")
        : kind === "upload"
          ? t("pain.speech.upload")
          : t("pain.speech.none");
  const hold = Number(session?.suggestion_hold_usd);
  const holdLabel =
    session?.suggestion_hold_usd && Number.isFinite(hold)
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
        }).format(hold)
      : "";
  const stated = statedIntensity(sourceText);
  const levelKey = result?.pain_level ? painLevelKey(result.pain_level) : null;
  const shownSide = result?.side ? sideKey(result.side.id) : null;

  return (
    <details
      className="pain-suggest"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadSession();
      }}
    >
      <summary>{t("pain.summary")}</summary>
      <p className="pain-status">{t("pain.intro")}</p>
      <label className="field-label" htmlFor="pain-description">
        {t("pain.describe")}
      </label>
      <textarea
        id="pain-description"
        className="notebook-input"
        rows={4}
        maxLength={3000}
        value={text}
        placeholder={t("pain.placeholder")}
        onChange={(event) => updateDescription(event.target.value)}
      />
      <div className="pain-actions">
        {recording ? (
          <button type="button" className="secondary" onClick={() => void finishRecording()}>
            <Square size={14} /> {t("pain.stopSpeech")}
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => void listen()}
            disabled={busy || kind === "none"}
          >
            <Mic size={14} /> {t("pain.startSpeech")}
          </button>
        )}
        <button type="button" className="secondary" onClick={() => void suggest()} disabled={busy}>
          {t("pain.suggest")}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!plainText(text)}
          onClick={() => props.onInsertText(plainText(text))}
        >
          {t("pain.addWords")}
        </button>
      </div>
      <p className="pain-status">{speechNote}</p>
      {kind === "upload" && (
        <label className="consent">
          <input
            type="checkbox"
            checked={recordConsent}
            onChange={(event) => setRecordConsent(event.target.checked)}
          />
          <span>
            {t("pain.recordConsent", {
              provider: session?.transcription_provider ?? t("pain.providerFallback"),
            })}
          </span>
        </label>
      )}
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>{t("pain.consent")}</span>
      </label>
      {session?.pain_suggestions && holdLabel && (
        <p className="pain-status">{t("pain.cost", { amount: holdLabel })}</p>
      )}
      {session?.turnstile_site_key && (
        <VisitorCheck siteKey={session.turnstile_site_key} nonce={nonce} onToken={setToken} />
      )}
      {error && (
        <p className="pain-status" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="pain-status" role="status">
          {status}
        </p>
      )}
      {result && (
        <div className="pain-suggestion">
          <strong>{t("pain.heading")}</strong>
          <p className="pain-status">{t("pain.scope")}</p>
          {shownSide && <p>{t(shownSide)}</p>}
          {levelKey && (
            <div className="pain-row">
              <span>{t("pain.band", { label: t(levelKey) })}</span>
              {stated != null ? (
                <button
                  type="button"
                  onClick={() => {
                    const exact = statedIntensity(sourceText);
                    if (exact == null) return;
                    props.onUseIntensity(exact);
                  }}
                >
                  {t("pain.useStated", { level: stated })}
                </button>
              ) : (
                <span className="pain-status">{t("pain.bandOnly")}</span>
              )}
            </div>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              clearSuggestion();
              setStatus("");
            }}
          >
            {t("pain.clear")}
          </button>
        </div>
      )}
    </details>
  );
}
