import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "../api.ts";
import { isNativeApp } from "../platform/files.ts";
import type { RegionId, Session } from "../types.ts";
import VisitorCheck from "../VisitorCheck.tsx";
import { localVoiceClient } from "../voice/client.ts";
import { startRecording, toWav, type Recording } from "../voice/recording.ts";
import {
  advisoryCopy,
  highlightIds,
  optionLabel,
  painLevelCopy,
  PAIN_LEVEL_SCALE,
  plainText,
  readSuggestion,
  regionTitle,
  sideCopy,
  suggestedIntensity,
  type PainLevel,
  type PainRegionHit,
  type PainSuggestion,
  type PainSide,
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

function RegionRow({
  region,
  side,
  spread = false,
  onShow,
  onAddPin,
}: {
  region: PainRegionHit;
  side: PainSide | null;
  spread?: boolean;
  onShow(region: RegionId): void;
  onAddPin(region: RegionId): void;
}) {
  const name = regionTitle(region, side);
  if (!name) return null;
  const title = spread ? `Spreads to ${name}` : name;
  return (
    <div className="pain-row" data-anatomy={region.anatomy_id}>
      <span>{title}</span>
      <button type="button" onClick={() => onShow(region.anatomy_id)}>
        Show {name} on the body
      </button>
      <button type="button" onClick={() => onAddPin(region.anatomy_id)}>
        Add a pin for {name}
      </button>
    </div>
  );
}

function PainLevelControl({
  suggested,
  value,
  onChange,
  onApply,
}: {
  suggested: PainLevel | null;
  value: number | null;
  onChange(value: number): void;
  onApply(value: number): void;
}) {
  const copy = suggested ? painLevelCopy(suggested) : null;
  return (
    <div className="pain-row pain-level-row">
      {copy && <span>{copy}</span>}
      <div className="pain-level-picks" role="radiogroup" aria-label="Pain level">
        {PAIN_LEVEL_SCALE.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={value === null}
        onClick={() => {
          if (value !== null) onApply(value);
        }}
      >
        Use as level
      </button>
    </div>
  );
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
  const [chosenLevel, setChosenLevel] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [nonce, setNonce] = useState(0);
  const kind = speechKind();
  const generation = useRef(0);
  const capture = useRef<Recording | null>(null);
  const speech = useRef(liveSpeech());
  const heard = useRef("");

  function clearSuggestion() {
    setResult(null);
    setChosenLevel(null);
    props.onHighlight([]);
  }

  useEffect(() => {
    return () => {
      generation.current++;
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
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const current = (await loadSession()) ?? session;
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
      setChosenLevel(suggestedIntensity(parsed.pain_level));
      props.onHighlight(
        highlightIds([
          ...(parsed.regions ?? []),
          ...(parsed.radiation?.regions ?? []),
        ]),
      );
      const namedSide = parsed.side && parsed.side.id !== "unspecified";
      const empty =
        !parsed.regions &&
        !namedSide &&
        !parsed.pain_type &&
        !parsed.severity &&
        !parsed.pain_level &&
        !parsed.radiation &&
        !parsed.triggers &&
        !parsed.red_flags;
      setStatus(empty ? "Nothing in that description was clear enough to suggest." : "");
    } catch (caught) {
      clearSuggestion();
      setError(
        caught instanceof Error
          ? caught.message
          : "The suggestion could not be requested.",
      );
    } finally {
      setBusy(false);
      setToken("");
      setNonce((value) => value + 1);
    }
  }

  const advice = advisoryCopy(result?.red_flags);
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
          {advice && (
            <p className="pain-advice" role="status">
              {advice}
            </p>
          )}
          {result.red_flags?.map((flag) => {
            const label = optionLabel("red_flags", flag.id);
            return label ? <p key={flag.id}>{label}</p> : null;
          })}
          {result.side && sideCopy(result.side.id) && <p>{sideCopy(result.side.id)}</p>}
          {result.regions?.map((region) => (
            <RegionRow
              key={region.id}
              region={region}
              side={result.side}
              onShow={props.onShow}
              onAddPin={props.onAddPin}
            />
          ))}
          {result.pain_type && optionLabel("pain_types", result.pain_type.id) && (
            <div className="pain-row">
              <span>{optionLabel("pain_types", result.pain_type.id)}</span>
              <button
                type="button"
                onClick={() =>
                  props.onUseQuality(optionLabel("pain_types", result.pain_type!.id)!)
                }
              >
                Use as feeling
              </button>
            </div>
          )}
          {result.severity && optionLabel("severity", result.severity.id) && (
            <p>Severity hint: {optionLabel("severity", result.severity.id)}</p>
          )}
          <PainLevelControl
            suggested={result.pain_level}
            value={chosenLevel}
            onChange={setChosenLevel}
            onApply={props.onUseIntensity}
          />
          {result.radiation && !result.radiation.regions && (
            <p>Spreads. The destination was not clear enough to suggest.</p>
          )}
          {result.radiation?.regions?.map((region) => (
            <RegionRow
              key={`spread-${region.id}`}
              region={region}
              side={result.side}
              spread
              onShow={props.onShow}
              onAddPin={props.onAddPin}
            />
          ))}
          {result.triggers?.map((trigger) => {
            const label = optionLabel("triggers", trigger.id);
            return label ? (
              <div className="pain-row" key={trigger.id}>
                <span>{label}</span>
                <button type="button" onClick={() => props.onUseActivity(label)}>
                  Use {label} as activity
                </button>
              </div>
            ) : null;
          })}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              clearSuggestion();
              setStatus("");
            }}
          >
            Dismiss suggestion
          </button>
        </div>
      )}
    </details>
  );
}
