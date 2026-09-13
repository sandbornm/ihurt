import { useRef, useState } from "react";
import { Sparkles, LoaderCircle, ArrowRight } from "lucide-react";
import { api, ApiError } from "./api";
import type { Answer, HurtMap, ProviderId, SavedMap, Session } from "./types";
import { entryFingerprint } from "./notebook-data";
import VisitorCheck from "./VisitorCheck";
import VoiceNote from "./VoiceNote";
export interface AssistantProps {
  entry: SavedMap;
  onSave: (analysis: NonNullable<SavedMap["ai"]>) => void;
  onNote: (text: string) => void;
}
export default function AIOptions({ entry, onSave, onNote }: AssistantProps) {
  const [open, setOpen] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [provider, setProvider] = useState<ProviderId>("demo");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const [result, setResult] = useState<HurtMap | null>(null),
    [answers, setAnswers] = useState<Answer[]>([]),
    [answer, setAnswer] = useState("");
  const [activityId, setActivityId] = useState<string | null>(null),
    [token, setToken] = useState(""),
    [nonce, setNonce] = useState(0);
  const submitted = useRef(false),
    snapshot = useRef("");
  const live = provider !== "local" && provider !== "demo";
  const resetChallenge = () => {
    setToken("");
    setNonce((n) => n + 1);
  };
  async function connect() {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const data = await api<Session>("session");
      setSession(data);
      setProvider(data.provider);
    } catch {
      setError(
        "The optional AI server is not running. Use npm run dev:ai, or export JSON to use in your own AI chat.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(value = answer) {
    if (!session || submitted.current) return;
    if (activityId && snapshot.current !== entryFingerprint(entry)) {
      setError(
        "Your entry changed. Start a new AI review to include the edits.",
      );
      return;
    }
    const seeded: Answer[] = (
      ["quality", "activity", "duration"] as const
    ).flatMap((key) => (entry.map[key] ? [{ key, text: entry.map[key] }] : []));
    if (entry.map.intensity !== null)
      seeded.push({ key: "intensity", text: String(entry.map.intensity) });
    const nextAnswers = result?.question
      ? [...answers, { key: result.question.key, text: value.trim() }]
      : seeded;
    if (result?.question && !value.trim()) return;
    submitted.current = true;
    setBusy(true);
    setError("");
    const fingerprint = entryFingerprint(entry);
    try {
      const response = await api<{
        activity_id: string;
        map: HurtMap;
        remaining: number;
        provider: ProviderId;
      }>("map", {
        request_id: crypto.randomUUID(),
        activity_id: activityId,
        note:
          entry.note.trim() ||
          "Please review the locations and comments recorded in this journal entry.",
        selected_region: entry.map.regions[0] ?? null,
        answers: nextAnswers,
        consent,
        challenge_token: token,
        provider,
        points: (entry.points ?? []).map(
          ({ id, region, position, structure, comment, area }) => ({
            id: /^[a-f0-9-]{36}$/.test(id) ? id : crypto.randomUUID(),
            region,
            position,
            structure: structure.slice(0, 150),
            comment: comment ?? "",
            area,
          }),
        ),
      });
      snapshot.current = fingerprint;
      setActivityId(response.activity_id);
      setResult(response.map);
      setAnswers(nextAnswers);
      setAnswer("");
      setSession((s) => (s ? { ...s, remaining: response.remaining } : s));
      if (!response.map.question)
        onSave({
          provider: response.provider,
          created: new Date().toISOString(),
          based_on: fingerprint,
          map: response.map,
          answers: nextAnswers,
        });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The AI review could not finish.",
      );
      if (e instanceof ApiError) {
        if (e.activityId) {
          setActivityId(e.activityId);
          snapshot.current = fingerprint;
        }
        if (e.remaining !== undefined)
          setSession((s) => (s ? { ...s, remaining: e.remaining! } : s));
      }
    } finally {
      setBusy(false);
      submitted.current = false;
      resetChallenge();
    }
  }
  const disabled =
    busy ||
    !session ||
    (live && !consent) ||
    (!activityId && session.remaining === 0) ||
    (!!session.turnstile_site_key && !token);
  return (
    <section className="optional-ai">
      <button
        className="text-button"
        onClick={() =>
          open ? setOpen(false) : session ? setOpen(true) : void connect()
        }
      >
        <Sparkles size={14} />
        {open ? "Hide AI tools" : "Optional AI tools"}
      </button>
      {open && (
        <div className="ai-tools">
          <p>
            AI can help review your record. Its notes are saved separately from
            yours.
          </p>
          <a
            href="https://github.com/sandbornm/ihurt/blob/main/docs/PROVIDERS.md"
            target="_blank"
            rel="noreferrer"
          >
            Keys, local models, and costs ↗
          </a>
          {session && (
            <>
              <div className="provider-row">
                <label htmlFor="provider">Review with</label>
                <select
                  id="provider"
                  value={provider}
                  disabled={busy || !!activityId}
                  onChange={(e) => {
                    setProvider(e.target.value as ProviderId);
                    setConsent(false);
                  }}
                >
                  {session.providers
                    .filter((p) => p.id !== "demo")
                    .map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.name}
                        {!p.available ? " · not configured" : ""}
                      </option>
                    ))}
                  {provider === "demo" && (
                    <option value="demo">Choose a configured model</option>
                  )}
                </select>
              </div>
              <p className="subtle">
                {provider === "local"
                  ? "Sends the entry to your configured model server."
                  : "Cloud providers receive your note, pins, comments, and answers. Their retention and billing policies apply."}{" "}
                {session.remaining} AI activities left today. Journaling is
                unlimited.
              </p>
              {(live || session.transcription_available) && (
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    I agree to send this entry to the selected provider
                    {session.transcription_available
                      ? ", and recordings to OpenAI for transcription"
                      : ""}
                    .
                  </span>
                </label>
              )}
              <VoiceNote
                disabled={busy}
                live={session.transcription_available}
                consent={consent}
                maxSeconds={session.max_audio_seconds}
                challengeToken={token}
                onText={onNote}
                onError={setError}
                onConsumed={resetChallenge}
              />
              <p className="subtle">
                Browser dictation may use a remote speech service. Typing stays
                in the notebook.
              </p>
              <VisitorCheck
                siteKey={session.turnstile_site_key}
                nonce={nonce}
                onToken={setToken}
              />
              {result && (
                <div className="ai-result">
                  <strong>{result.title}</strong>
                  <p>{result.summary}</p>
                  {result.safety_message && (
                    <p role="alert">{result.safety_message}</p>
                  )}
                </div>
              )}
              {result?.question && (
                <>
                  <label htmlFor="ai-answer">{result.question.prompt}</label>
                  <textarea
                    id="ai-answer"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    maxLength={500}
                  />
                  <div className="answer-options">
                    {result.question.options.map((option) => (
                      <button
                        key={option}
                        disabled={disabled}
                        onClick={() => void submit(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {!result || result.question ? (
                <button
                  className="secondary"
                  disabled={
                    disabled ||
                    provider === "demo" ||
                    (!!result?.question && !answer.trim())
                  }
                  onClick={() => void submit()}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {result?.question ? "Continue review" : "Review with AI"}
                  <ArrowRight size={14} />
                </button>
              ) : null}
              {activityId && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setActivityId(null);
                    setAnswers([]);
                    setResult(null);
                    setError("");
                  }}
                >
                  Start a new AI review
                </button>
              )}
            </>
          )}
          {busy && !session && (
            <p role="status">Connecting to your local AI server…</p>
          )}
          {error && (
            <p className="error-notice" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
