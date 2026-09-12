import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Footprints,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Minus,
  MoveUpRight,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import {
  regionName,
  regions,
  type Answer,
  type HurtMap,
  type ProviderId,
  type RegionId,
  type SavedMap,
  type Session,
  type PainPoint,
} from "./types";
import { download } from "./export";
import VoiceNote from "./VoiceNote";
import VisitorCheck from "./VisitorCheck";
import FeatureBoundary from "./FeatureBoundary";
import Resources from "./Resources";
import { recommendedSources, findReadings, sources } from "./reading";
import { bodyAnchors, muscleGroups } from "./anatomy/landmarks";
const Anatomy = lazy(() => import("./anatomy/Anatomy"));
const noRegions: RegionId[] = [];
const providerNames: Record<ProviderId, string> = {
  demo: "Demo · no AI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  grok: "xAI / Grok",
  local: "your local model",
};
const examples = [
  {
    label: "After a run",
    icon: Footprints,
    text: "There’s a dull ache around my right knee after running.",
  },
  {
    label: "Slept weird",
    icon: BookOpen,
    text: "I woke up with a crick in my neck after sleeping awkwardly.",
  },
  {
    label: "Tennis serve",
    icon: MoveUpRight,
    text: "I notice tightness in my right shoulder when I serve in tennis.",
  },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [provider, setProvider] = useState<ProviderId>("demo");
  const [tab, setTab] = useState<"explore" | "journal">("explore");
  const [selected, setSelected] = useState<RegionId | null>(null),
    [layer, setLayer] = useState<"muscle" | "bone">("muscle"),
    [view, setView] = useState<"front" | "back">("front");
  const [command, setCommand] = useState({ type: "", id: 0 });
  const [landmarks, setLandmarks] = useState(true);
  const [points, setPoints] = useState<PainPoint[]>([]);
  const [readingSources, setReadingSources] = useState(recommendedSources);
  const [note, setNote] = useState(""),
    [answer, setAnswer] = useState(""),
    [answers, setAnswers] = useState<Answer[]>([]),
    [result, setResult] = useState<HurtMap | null>(null),
    [activityId, setActivityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [saved, setSaved] = useState<SavedMap[]>([]),
    [toast, setToast] = useState("");
  const [search, setSearch] = useState(""),
    [challengeToken, setChallengeToken] = useState(""),
    [challengeNonce, setChallengeNonce] = useState(0);
  const [infoTab, setInfoTab] = useState<"about" | "privacy">("about");
  const infoDialog = useRef<HTMLDialogElement>(null),
    regionDialog = useRef<HTMLDialogElement>(null),
    noteInput = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const live = provider !== "demo" && provider !== "local";
  const completed = !!result && !result.question;
  useEffect(() => {
    let cancelled = false;
    api<Session>("session")
      .then((s) => {
        if (!cancelled) {
          setSession(s);
          setProvider(s.provider);
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "The API is unavailable. Start the app with “npm run dev”, then refresh.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function showInfo(which: "about" | "privacy") {
    setInfoTab(which);
    infoDialog.current?.showModal();
  }
  function selectRegion(id: RegionId) {
    setSelected(id);
    setView(id.includes("back") ? "back" : "front");
    regionDialog.current?.close();
  }
  function action(type: string) {
    setCommand((v) => ({ type, id: v.id + 1 }));
  }
  function resetChallenge() {
    setChallengeToken("");
    setChallengeNonce((n) => n + 1);
  }
  async function submit(text?: string) {
    if (submitting.current || !session) return;
    const value = text ?? (result ? answer : note);
    if ((result && !value.trim()) || (!result && note.trim().length < 3))
      return;
    const nextAnswers = result?.question
      ? [...answers, { key: result.question.key, text: value.trim() }]
      : answers;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await api<{
        activity_id: string;
        map: HurtMap;
        remaining: number;
        provider: ProviderId;
      }>("map", {
        request_id: crypto.randomUUID(),
        activity_id: activityId,
        note: note.trim(),
        selected_region: selected,
        answers: nextAnswers,
        consent,
        challenge_token: challengeToken,
        provider,
        points,
      });
      setActivityId(response.activity_id);
      setResult(response.map);
      setAnswers(nextAnswers);
      setAnswer("");
      setSession((s) => (s ? { ...s, remaining: response.remaining } : s));
      if (response.map.regions[0]) {
        selectRegion(response.map.regions[0]);
        action("focus");
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The map could not be created. Please try again.",
      );
      if (e instanceof ApiError) {
        if (e.activityId) setActivityId(e.activityId);
        if (e.remaining !== undefined)
          setSession((s) => (s ? { ...s, remaining: e.remaining! } : s));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
      resetChallenge();
    }
  }
  function newMap() {
    setResult(null);
    setActivityId(null);
    setAnswers([]);
    setNote("");
    setAnswer("");
    setSelected(null);
    setError("");
    setConsent(false);
    setPoints([]);
    setTab("explore");
    action("reset");
  }
  function currentMap(): SavedMap {
    return {
      id: activityId ?? crypto.randomUUID(),
      created: new Date().toISOString(),
      note,
      map: result!,
      answers,
      points,
      provider: providerNames[provider],
      references: result?.urgent
        ? []
        : findReadings(result?.regions ?? [], note, readingSources).map(
            (r) => ({
              title: r.title,
              url: r.url,
              publisher: sources.find((s) => s.id === r.source)!.name,
              checked: r.checked,
            }),
          ),
    };
  }
  function saveMap() {
    if (!result) return;
    const item = currentMap();
    setSaved((old) => [...old.filter((m) => m.id !== item.id), item]);
    setToast("Added to this session. Download it before closing this tab.");
  }
  const disabled =
    busy ||
    !session ||
    (!activityId && session.remaining === 0) ||
    (live && !consent) ||
    (!activityId && !!session.turnstile_site_key && !challengeToken);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="ihurt home">
          <span className="brand-mark">
            <Activity size={23} strokeWidth={2} />
          </span>
          ihurt<span className="brand-period">.</span>
        </a>
        <span className="brand-caption">A LITTLE MORE BODY AWARENESS</span>
        <div className="top-actions">
          <button onClick={() => showInfo("privacy")} className="privacy-link">
            <ShieldCheck size={15} />
            Anonymous by design
          </button>
          <button className="help-button" onClick={() => showInfo("about")}>
            <CircleHelp size={18} />
            <span>How it works</span>
          </button>
          <div className="avatar">you</div>
        </div>
      </header>
      <div className="workspace">
        <nav className="rail" aria-label="Main navigation">
          <button
            className={tab === "explore" ? "active" : ""}
            onClick={() => setTab("explore")}
            title="Anatomy explorer"
            aria-label="Anatomy explorer"
          >
            <Layers3 size={21} />
          </button>
          <button
            className={tab === "journal" ? "active" : ""}
            onClick={() => setTab("journal")}
            title="This session’s maps"
            aria-label="This session’s maps"
          >
            <BookOpen size={20} />
            {saved.length > 0 && (
              <span className="rail-count">{saved.length}</span>
            )}
          </button>
          <span className="rail-spacer" />
          <button
            onClick={() => showInfo("privacy")}
            title="Privacy and AI providers"
            aria-label="Privacy and AI providers"
          >
            <SlidersHorizontal size={20} />
          </button>
        </nav>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR PERSONAL BODY ATLAS</div>
              <h1>
                Map how you feel<span>.</span>
              </h1>
              <p>A little context for the things your body is telling you.</p>
            </div>
            <button className="new-map-button" onClick={newMap} disabled={busy}>
              <Plus size={17} />
              New hurt map
            </button>
          </div>
          <div className="page-tabs">
            <button
              className={tab === "explore" ? "selected" : ""}
              onClick={() => setTab("explore")}
            >
              <Layers3 size={16} />
              Anatomy explorer
            </button>
            <button
              className={tab === "journal" ? "selected" : ""}
              onClick={() => setTab("journal")}
            >
              <BookOpen size={16} />
              My hurt maps<span className="count">{saved.length}</span>
            </button>
            <span className="session-badge">
              <span />
              {session
                ? `${session.remaining} of ${session.limit} maps left today`
                : "Connecting…"}
            </span>
          </div>
          {tab === "journal" ? (
            <section className="journal">
              <div className="journal-heading">
                <h2>Your maps, for this visit.</h2>
                <p>
                  Download anything you want to keep. Closing or refreshing this
                  tab clears this journal.
                </p>
              </div>
              {saved.length === 0 ? (
                <div className="empty-journal">
                  <BookOpen size={40} strokeWidth={1} />
                  <h3>A place to put the pieces together.</h3>
                  <p>
                    Your saved hurt maps will appear here during this visit.
                  </p>
                  <button className="primary" onClick={() => setTab("explore")}>
                    Make your first map
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="journal-grid">
                  {saved.map((item) => (
                    <article className="journal-card" key={item.id}>
                      <div className="card-overline">
                        <MapPin size={17} />
                        {new Date(item.created).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        <button
                          aria-label={`Remove ${item.map.title}`}
                          onClick={() =>
                            setSaved((s) => s.filter((m) => m.id !== item.id))
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <h3>{item.map.title}</h3>
                      <p>{item.map.summary}</p>
                      <div className="region-tags">
                        {item.map.regions.map((r) => (
                          <span key={r}>{regionName(r)}</span>
                        ))}
                      </div>
                      <button
                        className="secondary"
                        onClick={() => download(item, "svg")}
                      >
                        <ArrowDownToLine size={16} />
                        Download hurt map
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="explorer-grid">
              <section
                className="body-workspace"
                aria-label="Interactive body map"
              >
                <div className="body-toolbar">
                  <div>
                    <span className="small-label">EXPLORE YOUR ANATOMY</span>
                    <h2>
                      {layer === "muscle"
                        ? "Musculoskeletal view"
                        : "Skeletal view"}
                      <ChevronDown size={14} />
                    </h2>
                  </div>
                  <span className="model-badge">3D ATLAS</span>
                </div>
                <div className="anatomy-stage">
                  <div className="stage-grid" />
                  <div className="landmark-menu">
                    <button
                      className={landmarks ? "landmark-active" : ""}
                      onClick={() => setLandmarks((v) => !v)}
                      aria-pressed={landmarks}
                    >
                      <Crosshair size={14} />
                      Landmarks
                    </button>
                    {landmarks && (
                      <div className="landmark-content">
                        <div className="landmark-breadcrumb">
                          <button
                            onClick={() => {
                              setSelected(null);
                              action("reset");
                            }}
                          >
                            Body
                          </button>
                          {selected && (
                            <>
                              <ChevronRight size={10} />
                              <span>{regionName(selected)}</span>
                            </>
                          )}
                        </div>
                        {!selected ? (
                          bodyAnchors.map((a) => (
                            <button
                              key={a.region}
                              onClick={() => {
                                selectRegion(a.region);
                                action("focus");
                              }}
                            >
                              {a.name}
                              <ChevronRight size={12} />
                            </button>
                          ))
                        ) : (
                          <>
                            <div className="surface-buttons">
                              {[
                                ["anterior", "Front"],
                                ["posterior", "Back"],
                                ["superior", "Top"],
                                ["lateral", "Outer side"],
                              ].map(([key, label]) => (
                                <button
                                  key={key}
                                  onClick={() => {
                                    if (key === "anterior") setView("front");
                                    if (key === "posterior") setView("back");
                                    action("surface:" + key);
                                  }}
                                >
                                  {label}
                                  <small>{key}</small>
                                </button>
                              ))}
                            </div>
                            <span className="small-label">MUSCLE GROUPS</span>
                            {muscleGroups(selected).map((m) => (
                              <button
                                key={m.match}
                                className={
                                  command.type === "muscle:" + m.match
                                    ? "landmark-active"
                                    : ""
                                }
                                onClick={() => {
                                  setLayer("muscle");
                                  setView(m.back ? "back" : "front");
                                  action("muscle:" + m.match);
                                }}
                              >
                                {m.name}
                                <ChevronRight size={12} />
                              </button>
                            ))}
                            <button
                              className="show-context"
                              onClick={() => action("context")}
                            >
                              Show surrounding anatomy
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="stage-cross top-left">+</div>
                  <div className="stage-cross bottom-right">+</div>
                  <div className="stage-intro">
                    <span className="small-label">START WITH A SPOT</span>
                    <p>
                      Every body has
                      <br />a story.
                    </p>
                    <span>
                      Pin a spot.
                      <br />
                      Add what you notice.
                    </span>
                    <button onClick={() => regionDialog.current?.showModal()}>
                      <Search size={14} />
                      Find a region
                    </button>
                  </div>
                  <FeatureBoundary label="The 3D view">
                    <Suspense
                      fallback={
                        <div className="canvas-loading">
                          Preparing your anatomy view…
                        </div>
                      }
                    >
                      <Anatomy
                        selected={selected}
                        mapped={result?.regions ?? noRegions}
                        intensity={result?.intensity ?? null}
                        layer={layer}
                        view={view}
                        command={command}
                        onSelect={setSelected}
                        points={points}
                        onPoint={(point) => {
                          if (points.length >= 6) {
                            setToast(
                              "Six spots per map. Remove one to add another.",
                            );
                            return;
                          }
                          setPoints((old) => [...old, point]);
                        }}
                      />
                    </Suspense>
                  </FeatureBoundary>
                  <div className="view-switch" aria-label="Body orientation">
                    <button
                      aria-pressed={view === "front"}
                      className={view === "front" ? "active" : ""}
                      onClick={() => setView("front")}
                    >
                      Front
                    </button>
                    <button
                      aria-pressed={view === "back"}
                      className={view === "back" ? "active" : ""}
                      onClick={() => setView("back")}
                    >
                      Back
                    </button>
                  </div>
                  <span className="body-side right-side">
                    {view === "front" ? "R" : "L"}
                  </span>
                  <span className="body-side left-side">
                    {view === "front" ? "L" : "R"}
                  </span>
                  {selected && (
                    <div className="region-callout">
                      <span className="callout-dot" />
                      <div>
                        <span>
                          {result?.regions.includes(selected)
                            ? "REPORTED REGION"
                            : "SELECTED REGION"}
                        </span>
                        <strong>{regionName(selected)}</strong>
                      </div>
                      <button
                        title="Focus on region"
                        aria-label="Focus on selected region"
                        onClick={() => action("focus")}
                      >
                        <Crosshair size={17} />
                      </button>
                      <button
                        title="Clear selection"
                        aria-label="Clear selection"
                        onClick={() => setSelected(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="canvas-controls">
                    <button
                      onClick={() => action("zoom-in")}
                      aria-label="Zoom in"
                    >
                      <Plus size={18} />
                    </button>
                    <button
                      onClick={() => action("zoom-out")}
                      aria-label="Zoom out"
                    >
                      <Minus size={18} />
                    </button>
                    <span />
                    <button
                      onClick={() => action("reset")}
                      aria-label="Reset view"
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                  <div className="anatomy-bottom">
                    <span>
                      <RotateCcw size={12} />
                      Drag to orbit · Scroll to zoom · Right-drag to pan
                    </span>
                    <a
                      href="/models/ATTRIBUTION.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Anatomy credits ↗
                    </a>
                  </div>
                </div>
                <div className="body-footer">
                  <div className="layer-toggle">
                    <button
                      className={layer === "muscle" ? "active" : ""}
                      aria-pressed={layer === "muscle"}
                      onClick={() => setLayer("muscle")}
                    >
                      <Layers3 size={14} />
                      Muscles
                    </button>
                    <button
                      className={layer === "bone" ? "active" : ""}
                      aria-pressed={layer === "bone"}
                      onClick={() => setLayer("bone")}
                    >
                      Skeleton
                    </button>
                  </div>
                  <div className="heat-legend">
                    <span>
                      {result?.intensity != null
                        ? "Reported intensity"
                        : "Reported area"}
                    </span>
                    <div />
                    <span>
                      {result?.intensity != null ? "Mild" : "Location"}
                    </span>
                    <span>
                      {result?.intensity != null ? "Strong" : "Unrated"}
                    </span>
                  </div>
                </div>
                <Resources
                  region={selected ?? result?.regions[0] ?? null}
                  activity={`${note} ${result?.activity ?? ""}`}
                  urgent={result?.urgent ?? false}
                  selectedSources={readingSources}
                  onSources={setReadingSources}
                />
              </section>
              <aside className="intake-panel">
                <div className="intake-header">
                  <span className="spark-icon">
                    <Sparkles size={17} />
                  </span>
                  <div>
                    <h2>Let’s connect the dots</h2>
                    <p>Your words. A clearer picture.</p>
                  </div>
                </div>
                <div className="steps">
                  <span className="done">
                    {result ? <Check size={12} /> : 1}
                  </span>
                  <b>Describe</b>
                  <i />
                  <span className={result ? "done" : ""}>
                    {completed ? <Check size={12} /> : 2}
                  </span>
                  <b className={result ? "" : "muted"}>Refine</b>
                  <i />
                  <span className={completed ? "done" : ""}>3</span>
                  <b className={completed ? "" : "muted"}>Your map</b>
                </div>
                <div className="intake-content">
                  {points.length > 0 && (
                    <div className="pin-list">
                      <span className="small-label">
                        YOUR PRECISE SPOTS · {points.length}/6
                      </span>
                      {points.map((point, i) => (
                        <div key={point.id}>
                          <button
                            onClick={() => {
                              setSelected(point.region);
                              action("point:" + point.id);
                            }}
                          >
                            <span>{i + 1}</span>
                            <b>{regionName(point.region)}</b>
                            <small>{point.structure}</small>
                          </button>
                          <button
                            aria-label={`Remove spot ${i + 1}`}
                            onClick={() =>
                              setPoints((ps) =>
                                ps.filter((p) => p.id !== point.id),
                              )
                            }
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!result ? (
                    <>
                      <h3>
                        What’s on your mind
                        <br />— or in your muscles?
                      </h3>
                      <p className="intro-copy">
                        Pin the exact spot on the body. Then describe the
                        feeling and what you were doing.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mapped-heading">
                        <span className="small-label">
                          {completed ? "YOUR HURT MAP" : "TAKING SHAPE"}
                        </span>
                        <h3>{result.title}</h3>
                      </div>
                      <div className="region-tags">
                        {result.regions.map((r) => (
                          <button key={r} onClick={() => selectRegion(r)}>
                            <MapPin size={12} />
                            {regionName(r)}
                          </button>
                        ))}
                      </div>
                      <p className="summary">{result.summary}</p>
                      <dl className="map-facts">
                        <div>
                          <dt>Feeling</dt>
                          <dd>{result.quality}</dd>
                        </div>
                        <div>
                          <dt>Activity</dt>
                          <dd>{result.activity}</dd>
                        </div>
                        <div>
                          <dt>Timing</dt>
                          <dd>{result.duration}</dd>
                        </div>
                      </dl>
                      {result.intensity !== null && (
                        <div className="intensity-row">
                          <span>Your reported intensity</span>
                          <b>
                            {result.intensity}
                            <small>/10</small>
                          </b>
                          <div>
                            <i style={{ width: `${result.intensity * 10}%` }} />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {result?.urgent && (
                    <div className="urgent-notice" role="alert">
                      <ShieldCheck size={19} />
                      <p>{result.safety_message}</p>
                    </div>
                  )}
                  {!completed && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                      }}
                    >
                      {result?.question && (
                        <div className="question-box">
                          <span className="small-label">ONE USEFUL DETAIL</span>
                          <h4>{result.question.prompt}</h4>
                          <div className="answer-options">
                            {result.question.options.map((option) => (
                              <button
                                type="button"
                                key={option}
                                disabled={disabled}
                                onClick={() => void submit(option)}
                              >
                                {option}
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <label className="sr-only" htmlFor="pain-note">
                        {result ? "Your answer" : "Describe your discomfort"}
                      </label>
                      <div className="note-field">
                        <textarea
                          id="pain-note"
                          ref={noteInput}
                          value={result ? answer : note}
                          onChange={(e) =>
                            result
                              ? setAnswer(e.target.value)
                              : setNote(e.target.value)
                          }
                          placeholder={
                            result
                              ? "Or tell us in your own words…"
                              : "“My shoulder feels tight when I reach overhead. It started a few days ago…”"
                          }
                          maxLength={result ? 500 : 3000}
                          disabled={busy}
                          rows={result ? 3 : 5}
                        />
                        <div className="note-tools">
                          <VoiceNote
                            disabled={busy}
                            live={session?.transcription_available ?? false}
                            consent={consent}
                            maxSeconds={session?.max_audio_seconds ?? 60}
                            challengeToken={challengeToken}
                            onText={(text) =>
                              result ? setAnswer(text) : setNote(text)
                            }
                            onError={setError}
                            onConsumed={resetChallenge}
                          />
                          <span>
                            {(result ? answer : note).length}/
                            {result ? 500 : 3000}
                          </span>
                        </div>
                      </div>
                      {!result && (
                        <>
                          <div className="example-label">
                            NEED A STARTING POINT?
                          </div>
                          <div className="example-chips">
                            {examples.map((example) => (
                              <button
                                type="button"
                                key={example.label}
                                onClick={() => {
                                  setNote(example.text);
                                  noteInput.current?.focus();
                                }}
                              >
                                <example.icon size={13} />
                                {example.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <div className="provider-row">
                        <label htmlFor="provider">
                          <Sparkles size={13} />
                          Map with
                        </label>
                        <select
                          id="provider"
                          value={provider}
                          disabled={!!activityId || busy}
                          onChange={(e) => {
                            setProvider(e.target.value as ProviderId);
                            setConsent(false);
                          }}
                        >
                          {(
                            session?.providers ?? [
                              {
                                id: "demo",
                                name: "Demo · no AI",
                                available: true,
                              },
                            ]
                          ).map((p) => (
                            <option
                              key={p.id}
                              value={p.id}
                              disabled={!p.available}
                            >
                              {p.name}
                              {!p.available ? " · not enabled" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      {(live || session?.transcription_available) && (
                        <label className="consent">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          <span>
                            I agree to send my note to{" "}
                            {live
                              ? providerNames[provider]
                              : "the selected provider"}
                            {session?.transcription_available
                              ? " and voice recordings to OpenAI for transcription"
                              : ""}
                            .{" "}
                            <button
                              type="button"
                              onClick={() => showInfo("privacy")}
                            >
                              Data use
                            </button>
                          </span>
                        </label>
                      )}
                      {(!activityId || session?.transcription_available) && (
                        <VisitorCheck
                          siteKey={session?.turnstile_site_key ?? ""}
                          nonce={challengeNonce}
                          onToken={setChallengeToken}
                        />
                      )}
                      <button
                        className="primary map-button"
                        type="submit"
                        disabled={
                          disabled ||
                          (!result ? note.trim().length < 3 : !answer.trim())
                        }
                      >
                        {busy ? (
                          <>
                            <LoaderCircle size={17} className="spin" />
                            Connecting the dots…
                          </>
                        ) : (
                          <>
                            <span>
                              {result ? "Add to my map" : "Create my hurt map"}
                            </span>
                            <ArrowRight size={17} />
                          </>
                        )}
                      </button>
                    </form>
                  )}
                  {error && (
                    <div className="error-notice" role="alert">
                      {error}
                      <button
                        onClick={() => setError("")}
                        aria-label="Dismiss error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {result && (
                    <div className="report-actions">
                      <button
                        className={completed ? "primary" : "secondary"}
                        onClick={saveMap}
                      >
                        <Check size={16} />
                        Keep in this session
                      </button>
                      <button
                        className="secondary"
                        onClick={() => download(currentMap(), "svg")}
                      >
                        <ArrowDownToLine size={16} />
                        Download hurt map
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setNote(
                            [note, ...answers.map((a) => `${a.key}: ${a.text}`)]
                              .join("\n")
                              .slice(0, 3000),
                          );
                          setResult(null);
                          setAnswers([]);
                        }}
                      >
                        Edit or add context
                        <Plus size={13} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() => download(currentMap(), "json")}
                      >
                        Export map data (.json)
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  )}
                  <div className="intake-footnote">
                    <LockKeyhole size={13} />
                    <span>
                      {live
                        ? `Sent only to ${providerNames[provider]} when you submit.`
                        : provider === "local"
                          ? "Your text goes to your configured local model."
                          : "Demo mode · no AI requests."}
                      <br />
                      Your notes clear when you close this tab.
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          )}
          <section className="support-strip">
            <div className="support-icon">
              <Activity size={21} />
            </div>
            <div>
              <h3>Awareness starts with noticing.</h3>
              <p>
                Your hurt map puts what you feel into words and a place on the
                body.
              </p>
            </div>
            <button onClick={() => showInfo("about")}>
              A note on hurt maps
              <ArrowUpRight size={15} />
            </button>
          </section>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              For education and personal reflection. Not medical advice,
              diagnosis, or treatment.
            </span>
            <button onClick={() => showInfo("privacy")}>
              Privacy & AI use
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      <dialog ref={regionDialog} className="dialog region-dialog">
        <div className="dialog-heading">
          <h2>Where do you feel it?</h2>
          <button
            onClick={() => regionDialog.current?.close()}
            aria-label="Close region picker"
          >
            <X size={20} />
          </button>
        </div>
        <div className="region-search">
          <Search size={17} />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a body region"
            aria-label="Search body regions"
          />
        </div>
        <p className="dialog-caption">Left and right refer to your own body.</p>
        <div className="region-list">
          {regions
            .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
            .map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  selectRegion(r.id);
                  action("focus");
                }}
              >
                <MapPin size={15} />
                <span>{regionName(r.id)}</span>
                <ChevronRight size={15} />
              </button>
            ))}
        </div>
      </dialog>
      <dialog ref={infoDialog} className="dialog info-dialog">
        <div className="dialog-heading">
          <div className="info-tabs">
            <button
              className={infoTab === "about" ? "active" : ""}
              onClick={() => setInfoTab("about")}
            >
              About hurt maps
            </button>
            <button
              className={infoTab === "privacy" ? "active" : ""}
              onClick={() => setInfoTab("privacy")}
            >
              Privacy & AI
            </button>
          </div>
          <button
            onClick={() => infoDialog.current?.close()}
            aria-label="Close information"
          >
            <X size={20} />
          </button>
        </div>
        {infoTab === "about" ? (
          <>
            <span className="dialog-emblem">
              <Activity size={28} />
            </span>
            <h2>A record of what you feel.</h2>
            <p>
              Describe discomfort, point to a region, and answer a few
              questions. Your hurt map brings those observations together. You
              can download it to keep or discuss with a clinician.
            </p>
            <h3>This is not medical advice whatsoever.</h3>
            <p>
              ihurt does not diagnose, treat, cure, or prevent any disease or
              condition. It is not intended as a medical device or a substitute
              for professional care. Do not use it to decide whether you need
              medical attention.
            </p>
            <p>
              The atlas uses Z-Anatomy and BodyParts3D models; its region
              boundaries and heat overlays are approximate. Colors show your
              reported discomfort and intensity, not an injury, a cause, a nerve
              pathway, or the likelihood of disease. AI can misinterpret your
              words. Review the result.
            </p>
            <p>
              If you have sudden chest pain, trouble breathing, new weakness, or
              loss of bladder or bowel control, seek emergency help. This app
              cannot assess emergencies.
            </p>
            <a
              href="https://www.nhs.uk/conditions/back-pain/"
              target="_blank"
              rel="noreferrer"
            >
              NHS: back pain and warning signs
              <ArrowUpRight size={13} />
            </a>
            <details>
              <summary>
                Learn some everyday anatomy
                <ChevronDown size={15} />
              </summary>
              <p>
                Muscles produce movement; tendons connect muscles to bones.
                Joints are where bones meet. Nerves carry signals, including
                sensations. A hurt map cannot tell which structure causes a
                symptom.
              </p>
              <div className="learn-links">
                <a
                  href="https://en.wikipedia.org/wiki/Human_musculoskeletal_system"
                  target="_blank"
                  rel="noreferrer"
                >
                  Musculoskeletal system ↗
                </a>
                <a
                  href="https://en.wikipedia.org/wiki/Peripheral_neuropathy"
                  target="_blank"
                  rel="noreferrer"
                >
                  About peripheral neuropathy ↗
                </a>
              </div>
            </details>
          </>
        ) : (
          <>
            <span className="dialog-emblem">
              <LockKeyhole size={26} />
            </span>
            <h2>Your body. Your choice.</h2>
            <p>
              No account, name, or email is required. Notes, answers, and maps
              stay in this tab’s memory. We do not save their content to our
              database or browser storage. Downloaded files contain your symptom
              information.
            </p>
            <h3>What goes to an AI provider?</h3>
            <p>
              In cloud mode, your note, pinned locations, selected region, and
              answers go through your local server to the provider you choose:
              OpenAI, Anthropic, or xAI. Only providers configured on your
              computer are available. With a local model, text goes to the
              endpoint you configured. Recorded voice notes use OpenAI for
              transcription when enabled. You review the transcript before
              mapping.
            </p>
            <p>
              Dictation uses your browser’s speech service, which may send audio
              to its provider. Use typing if you prefer. Demo mode organizes
              text on your local server with simple rules and makes no AI
              requests.
            </p>
            <h3>Anonymous does not mean untraceable.</h3>
            <p>
              Symptom notes are health-related information. Leave out names,
              contact details, and other identifying information. Each AI
              provider’s retention policies apply; we cannot promise zero
              retention by them. OpenAI response storage is disabled, which does
              not disable all provider logging.
            </p>
            <p>
              A temporary visitor cookie and daily hashed IP address enforce
              usage limits. The local database holds quota counts and random
              activity IDs, not notes. A cloud provider or, in a hosted copy,
              the host and bot-check service can receive technical data such as
              your IP. We use no analytics or session replay.
            </p>
            <h3>Usage limits.</h3>
            <p>
              The default is three new activities per day; you can change this
              in your local settings. Limits apply to your visitor session and
              network address, reset at midnight UTC, and are shared across AI
              providers. A shared network may share the allowance. Failed AI
              requests still count because they can incur costs.
            </p>
            <div className="learn-links">
              <a
                href="https://developers.openai.com/api/docs/guides/your-data"
                target="_blank"
                rel="noreferrer"
              >
                OpenAI data use ↗
              </a>
              <a
                href="https://privacy.claude.com/"
                target="_blank"
                rel="noreferrer"
              >
                Anthropic privacy ↗
              </a>
              <a
                href="https://x.ai/legal/privacy-policy"
                target="_blank"
                rel="noreferrer"
              >
                xAI privacy ↗
              </a>
            </div>
          </>
        )}
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
