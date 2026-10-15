import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "../api.ts";
import { isNativeApp } from "../platform/files.ts";
import type { RegionId, Session } from "../types.ts";
import VisitorCheck from "../VisitorCheck.tsx";
import { localVoiceClient } from "../voice/client.ts";
import { startRecording, toWav, type Recording } from "../voice/recording.ts";
import {
  painLevelCopy,
  plainText,
  readSuggestion,
  sideCopy,
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
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [recordConsent, setRecordConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<PainSuggestion | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [nonce, setNonce] = useState(0);
  const kind = speechKind();
  const generation = useRef(0);
  // Each suggest() call and unmount bumps this so stale responses are dropped.
  const suggestRun = useRef(0);
  const latestText = useRef("");
  latestText.current = text;
  const capture = useRef<Recording | null>(null);
  const speech = useRef(liveSpeech());
  const heard = useRef("");

  function clearSuggestion() {
    setResult(null);
    props.onHighlight([]);
  }

  useEffect(() => {
    return () => {
      generation.current++;
      suggestRun.current++;
      capture.current?.cancel();
      void speech.current?.cancel().catch(() => {});
    };
  }, []);

  async function loadSession() {
    if (isNativeApp()) return null;
    try {
      const next = await api<Session>("session");
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
    if (kind === "apple" || kind === "web") {
      const dictator = speech.current ?? liveSpeech();
      speech.current = dictator;
      if (!dictator) {
        setError("Speech recognition is unavailable. Type a description.");
        return;
      }
      try {
        let ended = false;
        await dictator.start(
          (value) => {
            if (generation.current !== current) return;
            heard.current = value.slice(0, 3000);
            setText(value.slice(0, 3000));
          },
          (message) => {
            ended = true;
            if (generation.current !== current) return;
            setRecording(false);
            if (message) setError(message);
          },
        );
        if (!ended && generation.current === current) setRecording(true);
      } catch {
        if (generation.current === current) {
          setRecording(false);
          setError("Speech recognition could not start. Type a description.");
        }
      }
      return;
    }
    if (kind !== "upload") {
      setError("Speech recognition is unavailable. Type a description.");
      return;
    }
    const currentSession = session ?? (await loadSession());
    if (!currentSession?.transcription_available) {
      setError(
        "Transcription is off on this server. Type a description, or turn on voice notes.",
      );
      return;
    }
    if (!recordConsent) {
      setError("Agree to send the recording for a transcript, or type instead.");
      return;
    }
    if (currentSession.turnstile_site_key && !token) {
      setError("Complete the visitor check, then try the microphone again.");
      return;
    }
    try {
      const next = await startRecording(
        () => {
          void finishRecording(current);
        },
        Math.min(60, currentSession.max_audio_seconds || 60),
        (message) => {
          if (generation.current !== current) return;
          capture.current = null;
          setRecording(false);
          setError(message);
        },
      );
      if (generation.current !== current) {
        next.cancel();
        return;
      }
      capture.current = next;
      setRecording(true);
    } catch {
      if (generation.current === current)
        setError("The microphone could not start. Type a description.");
    }
  }

  async function finishRecording(current = generation.current) {
    if (kind === "apple" || kind === "web") {
      setRecording(false);
      await speech.current?.stop().catch(() => {});
      if (heard.current) setText(heard.current.slice(0, 3000));
      return;
    }
    const pending = capture.current;
    if (!pending) return;
    setRecording(false);
    setBusy(true);
    try {
      const blob = await pending.stop();
      if (generation.current !== current) return;
      const audio = await toWav(
        blob,
        Math.min(60, session?.max_audio_seconds || 60),
      );
      const transcript = await localVoiceClient.transcribe(
        audio,
        token,
        new AbortController().signal,
      );
      if (generation.current === current) setText(transcript.slice(0, 3000));
    } catch (caught) {
      if (generation.current === current)
        setError(
          caught instanceof Error
            ? caught.message
            : "The recording could not be transcribed. Type a description.",
        );
    } finally {
      capture.current = null;
      if (generation.current === current) {
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
      setError("Describe the pain in a few words.");
      return;
    }
    if (isNativeApp()) {
      setError(
        "Suggestions run in the browser notebook with the local server. You can still add these words to your note.",
      );
      return;
    }
    if (!consent) {
      setError("Agree to send this description before asking for a suggestion.");
      return;
    }
    const run = ++suggestRun.current;
    const stale = () =>
      suggestRun.current !== run || plainText(latestText.current) !== description;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const current = (await loadSession()) ?? session;
      if (stale()) return;
      if (!current?.pain_suggestions) {
        clearSuggestion();
        setStatus("Suggestions are off on this server.");
        return;
      }
      if (current.turnstile_site_key && !token) {
        setError("Complete the visitor check, then try again.");
        return;
      }
      const response = await api<{ suggestion: unknown }>("pain", {
        request_id: crypto.randomUUID(),
        text: description,
        consent: true,
        challenge_token: token,
      });
      // The text changed or the panel closed while waiting: keep the new state, drop this answer.
      if (stale()) return;
      if (response.suggestion == null) {
        clearSuggestion();
        setStatus("Suggestions are off on this server.");
        return;
      }
      const parsed = readSuggestion(response.suggestion);
      if (!parsed) {
        clearSuggestion();
        setStatus("The suggestion could not be read. Your notes are unchanged.");
        return;
      }
      setResult(parsed);
      // Regions stay with the main map provider; Jev only suggests side and level.
      props.onHighlight([]);
      const namedSide = parsed.side && parsed.side.id !== "unspecified";
      const empty = !namedSide && !parsed.pain_level;
      setStatus(empty ? "Nothing in that description was clear enough to suggest." : "");
    } catch (caught) {
      if (stale()) return;
      clearSuggestion();
      setError(
        caught instanceof Error
          ? caught.message
          : "The suggestion could not be requested.",
      );
    } finally {
      if (suggestRun.current === run) setBusy(false);
      setToken("");
      setNonce((value) => value + 1);
    }
  }

  const speechNote =
    kind === "apple"
      ? "Speech stays on this device. The words stay in this box until you ask for a suggestion."
      : kind === "web"
        ? "This browser may send audio to its speech service. The words stay in this box until you ask for a suggestion."
        : kind === "upload"
          ? "Stopping sends the recording to the transcription service. Then you can ask for a suggestion."
          : "Type a description. Speech recognition is unavailable in this browser.";

  return (
    <details
      className="pain-suggest"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadSession();
      }}
    >
      <summary>Pain suggestion</summary>
      <p className="pain-status">
        Optional. A suggestion stays separate from your notes until you use it.
      </p>
      <label className="field-label" htmlFor="pain-description">
        Describe the pain
      </label>
      <textarea
        id="pain-description"
        className="notebook-input"
        rows={4}
        maxLength={3000}
        value={text}
        placeholder="Sharp pain on the left shoulder when I lift my arm"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="pain-actions">
        {recording ? (
          <button type="button" className="secondary" onClick={() => void finishRecording()}>
            <Square size={14} /> Stop speech
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => void listen()}
            disabled={busy || kind === "none"}
          >
            <Mic size={14} /> Start speech
          </button>
        )}
        <button type="button" className="secondary" onClick={() => void suggest()} disabled={busy}>
          Suggest
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!plainText(text)}
          onClick={() => props.onInsertText(plainText(text))}
        >
          Add these words to your note
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
            Send a recording to {session?.transcription_provider ?? "the transcription service"} for a transcript.
          </span>
        </label>
      )}
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>Send this description to TypeSafe for a suggestion.</span>
      </label>
      {session?.pain_suggestions && (
        <p className="pain-status">
          A short suggestion costs about $0.001. That estimate is not a spending limit.
        </p>
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
          <strong>AI suggestion</strong>
          <p className="pain-status">
            Side and pain level only. Place regions with the body map or your note.
          </p>
          {result.side && sideCopy(result.side.id) && <p>{sideCopy(result.side.id)}</p>}
          {result.pain_level && painLevelCopy(result.pain_level) && (
            <div className="pain-row">
              <span>{painLevelCopy(result.pain_level)}</span>
              <button
                type="button"
                onClick={() => props.onUseIntensity(result.pain_level!.value)}
              >
                Use as level
              </button>
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
            Clear suggestion
          </button>
        </div>
      )}
    </details>
  );
}
