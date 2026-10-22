import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Layers3,
  LockKeyhole,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  regionName,
  regionMatches,
  regions,
  type RegionId,
  type SavedMap,
  type PainPoint,
} from "./types";
import {
  download,
  downloadNotebook,
  downloadViewport,
  downloadReport,
  printMap,
} from "./export";
import { isNativeApp } from "./platform/files";
import { applyVoiceDraft } from "./voice/draft";
import { proposedPinStep, type ProposedPinAction } from "./voice/extraction";
import type { VoiceDraftProps } from "./voice/VoiceDraft";
import type { ViewportCapture } from "./anatomy/capture";
import {
  blankEntry,
  finishEntry,
  hasContent,
  parseNotebook,
  entryFingerprint,
} from "./notebook-data";
import {
  loadNotebook,
  saveDraft,
  saveResearch,
  storeEntries,
  removeEntry,
  type Draft,
} from "./notebook-storage";
import { activities, activityName, activityRegions } from "./activities";
import { exampleEntry } from "./example";
import { prepareOffline } from "./offline";
import FeatureBoundary from "./FeatureBoundary";
import Resources from "./Resources";
import IntensityDial from "./IntensityDial";
import ThemeToggle from "./ThemeToggle";
import Tutorial from "./Tutorial";
import ShareWithAI from "./sharing/ShareWithAI";
import Feedback from "./feedback/Feedback";
import FeedbackLinks from "./feedback/FeedbackLinks";
import AnatomyCredits from "./AnatomyCredits";
import { MarkHistory } from "./anatomy/history";
import { recommendedSources, findReadings, sources } from "./reading";
import { bodyAnchors, muscleGroups } from "./anatomy/landmarks";
import { useI18n } from "./i18n/react";
import { formatDate, type MessageKey } from "./i18n";
import LanguageSetting from "./i18n/LanguageSetting";
const Anatomy = lazy(() => import("./anatomy/Anatomy"));
const BodyReference = lazy(() => import("./anatomy/BodyReference"));
void import("./anatomy/Anatomy");
type AssistantProps = {
  entry: SavedMap;
  onSave: (analysis: NonNullable<SavedMap["ai"]>) => void;
  onNote: (text: string) => void;
};
export default function Notebook({
  example = false,
  allowCamera = true,
  Assistant,
  Research,
  VoiceInput,
}: {
  example?: boolean;
  allowCamera?: boolean;
  Assistant?: ComponentType<AssistantProps>;
  VoiceInput?: ComponentType<VoiceDraftProps>;
  Research?: ComponentType<{
    entry: SavedMap;
    sources: string[];
    onSave: (research: NonNullable<SavedMap["research"]>) => Promise<void>;
  }>;
}) {
  const { t } = useI18n();
  const [tutorial, setTutorial] = useState(false);
  const [advancedControls, setAdvancedControls] = useState(false);
  const [toolsMenu, setToolsMenu] = useState(false);
  const [offline, setOffline] = useState(false);
  const [bodyReference, setBodyReference] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [orientation, setOrientation] = useState<"front" | "back" | null>(
    example ? "back" : "front",
  );
  const capture = useRef<(() => ViewportCapture | null) | null>(null);
  useEffect(() => {
    void prepareOffline()
      .then(setOffline)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!toolsMenu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape" || document.querySelector("dialog[open]"))
          return;
      }
      if (
        event instanceof PointerEvent &&
        (event.target as Element | null)?.closest(".more-tools-wrap")
      )
        return;
      setToolsMenu(false);
      setLandmarks(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [toolsMenu]);
  const [entry, setEntry] = useState<SavedMap>(() =>
    example ? exampleEntry() : blankEntry(),
  );
  const [saved, setSaved] = useState<SavedMap[]>([]),
    [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<"explore" | "journal">("explore");
  const [selected, setSelected] = useState<RegionId | null>(
      example ? "neck" : null,
    ),
    [layer, setLayer] = useState<"muscle" | "bone">("muscle"),
    [view, setView] = useState<"front" | "back">(example ? "back" : "front");
  // Unconfirmed pin proposed from voice. Kept out of the autosaved draft.
  const [proposedPin, setProposedPin] = useState<RegionId | null>(null);
  const [command, setCommand] = useState({ type: "", id: 0 }),
    [landmarks, setLandmarks] = useState(false);
  const [readingSources, setReadingSources] = useState(recommendedSources);
  const [search, setSearch] = useState(""),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false),
    [draftStatus, setDraftStatus] = useState<MessageKey>("notebook.status.opening"),
    [removed, setRemoved] = useState<SavedMap | null>(null);
  const draftRef = useRef<Draft>({
    entry,
    selected,
    layer,
    showSkeleton,
    view,
    sources: readingSources,
  });
  draftRef.current = {
    entry,
    selected,
    layer,
    showSkeleton,
    view,
    sources: readingSources,
  };
  const infoDialog = useRef<HTMLDialogElement>(null),
    regionDialog = useRef<HTMLDialogElement>(null),
    regionSearch = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null);
  function openRegions() {
    regionDialog.current?.showModal();
    requestAnimationFrame(() =>
      regionSearch.current?.focus({ preventScroll: true }),
    );
  }
  const points = entry.points ?? [],
    note = entry.note,
    result = finishEntry(entry).map;
  const noRegions: RegionId[] = [];
  const valid = hasContent(entry);
  const markHistory = useRef(new MarkHistory());
  markHistory.current.select(entry.id);
  const setPoints = (
    updater: (old: PainPoint[]) => PainPoint[],
    remember = true,
  ) => {
    if (remember) markHistory.current.record(points);
    setEntry((old) => {
      const next = updater(old.points ?? []);
      return {
        ...old,
        points: next,
        updated: new Date().toISOString(),
        map: { ...old.map, regions: [...new Set(next.map((p) => p.region))] },
      };
    });
  };
  function change(patch: Partial<SavedMap>) {
    setEntry((e) => ({ ...e, ...patch, updated: new Date().toISOString() }));
  }
  function context(
    field: "title" | "quality" | "activity" | "duration" | "intensity",
    value: string | number | null,
  ) {
    setEntry((e) => ({
      ...e,
      updated: new Date().toISOString(),
      map: { ...e.map, [field]: value },
    }));
  }
  useEffect(() => {
    let cancelled = false;
    loadNotebook()
      .then((data) => {
        if (cancelled) return;
        setSaved(data.entries);
        if (data.draft) {
          const d = data.draft;
          setEntry(d.entry);
          setSelected(d.selected);
          setView(d.view);
          setLayer(d.layer);
          setShowSkeleton(d.showSkeleton !== false);
          setReadingSources(d.sources);
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          setHydrated(true);
          setStorageError(
            t("notebook.error.storageUnavailable"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [example]);
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setDraftStatus("notebook.status.saving");
    const persist = () =>
      saveDraft(draftRef.current)
        .then(() => {
          if (!cancelled) {
            setDraftStatus("notebook.status.saved");
            setStorageError("");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDraftStatus("notebook.status.notSaved");
            setStorageError(
              t("notebook.error.draftNotSaved"),
            );
          }
        });
    const timer = setTimeout(() => {
      void persist();
    }, 280);
    const flush = () => {
      clearTimeout(timer);
      void persist();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [
    entry,
    selected,
    layer,
    showSkeleton,
    view,
    readingSources,
    hydrated,
    example,
  ]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  function proposal(step: ProposedPinAction) {
    const next = proposedPinStep(proposedPin, step);
    setProposedPin(next.state);
    if (next.command) action(next.command);
  }
  useEffect(() => {
    setProposedPin(
      (current) =>
        proposedPinStep(current, { type: "select", region: selected }).state,
    );
  }, [selected]);
  useEffect(() => setProposedPin(null), [entry.id]);
  function selectRegion(id: RegionId) {
    setSelected(id);
    setView(id.includes("back") ? "back" : "front");
    regionDialog.current?.close();
  }
  function action(type: string) {
    if (window.innerWidth <= 670 && /^(focus|muscle:|surface:)/.test(type))
      setLandmarks(false);
    setCommand((c) => ({ type, id: c.id + 1 }));
  }
  function currentEntry(): SavedMap {
    const item = finishEntry(entry);
    return {
      ...item,
      references: [
        ...(item.research?.references ?? []),
        ...findReadings(
          item.map.regions,
          `${note} ${item.map.activity}`,
          readingSources,
        ).map((r) => ({
          title: r.title,
          kind: r.type === "Video" ? ("video" as const) : ("article" as const),
          url: r.url,
          publisher: sources.find((s) => s.id === r.source)!.name,
          checked: r.checked,
        })),
      ].filter((r, i, all) => all.findIndex((v) => v.url === r.url) === i),
    };
  }
  async function commit() {
    if (!valid || busy) return false;
    const item = currentEntry();
    setBusy(true);
    setError("");
    try {
      await storeEntries([item]);
      setSaved((old) => [...old.filter((e) => e.id !== item.id), item]);
      setToast(t("notebook.toast.saved"));
      return true;
    } catch {
      setError(
        t("notebook.error.saveFailed"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function newMap() {
    if (busy) return;
    if (valid) {
      setBusy(true);
      const item = currentEntry();
      try {
        await storeEntries([item]);
        setSaved((old) => [...old.filter((e) => e.id !== item.id), item]);
      } catch {
        setError(t("notebook.error.saveBeforeNew"));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setEntry(blankEntry());
    setSelected(null);
    setView("front");
    setError("");
    setTab("explore");
    action("reset");
  }
  function openEntry(item: SavedMap) {
    setEntry(structuredClone(item));
    setSelected(item.map.regions[0] ?? null);
    setView((item.points?.[0]?.position[2] ?? 0) < 0 ? "back" : "front");
    setTab("explore");
    setError("");
    action("reset");
  }
  async function openSaved(item: SavedMap) {
    if (busy) return;
    if (entry.id === item.id) {
      setTab("explore");
      return;
    }
    setBusy(true);
    try {
      if (valid && entry.id !== item.id) {
        const previous = currentEntry();
        await storeEntries([previous]);
        setSaved((old) => [
          ...old.filter((e) => e.id !== previous.id),
          previous,
        ]);
      }
      openEntry(item);
    } catch {
      setError(
        t("notebook.error.saveBeforeOpen"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function erase(item: SavedMap) {
    if (busy) return;
    setBusy(true);
    try {
      await removeEntry(item.id);
      setSaved((old) => old.filter((e) => e.id !== item.id));
      setRemoved(item);
      setToast(t("notebook.toast.deleted"));
      if (entry.id === item.id) {
        setEntry(blankEntry());
        setSelected(null);
      }
    } catch {
      setError(t("notebook.error.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function undoDelete() {
    if (!removed) return;
    try {
      await storeEntries([removed]);
      setSaved((old) => [...old.filter((e) => e.id !== removed.id), removed]);
      setRemoved(null);
      setToast(t("notebook.toast.restored"));
    } catch {
      setError(t("notebook.error.restoreFailed"));
    }
  }
  async function importFile(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error(t("notebook.error.importTooLarge"));
      const incoming = parseNotebook(await file.text());
      const additions = incoming.flatMap((item) => {
        const existing = saved.find((e) => e.id === item.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(item))
          return [];
        return [
          {
            ...item,
            id:
              existing || item.id === entry.id ? crypto.randomUUID() : item.id,
          },
        ];
      });
      await storeEntries(additions);
      setSaved((old) => [...old, ...additions]);
      setTab("journal");
      setToast(
        t("notebook.toast.imported", { count: additions.length }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("notebook.error.importFailed"));
    } finally {
      setBusy(false);
    }
  }
  function backup() {
    const records = new Map(saved.map((e) => [e.id, e]));
    if (valid) records.set(entry.id, currentEntry());
    void exportFile(() => downloadNotebook([...records.values()]));
  }
  async function exportFile(work: () => Promise<string>) {
    try {
      setToast(await work());
    } catch {
      setError(
        t("notebook.error.fileSaveFailed"),
      );
    }
  }
  return (
    <div
      className="app-shell notebook-shell"
      data-offline={offline ? "ready" : "preparing"}
    >
      <header className="topbar">
        <a href={example ? "/" : "#"} className="brand" aria-label={t("notebook.home")}>
          <span className="brand-mark">
            <img src="/favicon.svg" width="34" height="34" alt="" />
          </span>
          iHurt<span className="brand-period">.</span>
        </a>
        <div className="top-actions">
          <LanguageSetting />
          <ThemeToggle />
          <button
            className="privacy-link tour-button"
            onClick={() => setTutorial(true)}
          >
            <CircleHelp size={18} /> {t("notebook.quickTour")}
          </button>
          {example && (
            <a
              className="privacy-link"
              href="https://github.com/sandbornm/ihurt"
            >
              {t("notebook.getNotebook")}
            </a>
          )}
          <button
            className="privacy-link"
            onClick={() => infoDialog.current?.showModal()}
          >
            <CircleHelp size={17} />
            <span>{t("notebook.aboutPrivacy")}</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <nav className="rail" aria-label={t("notebook.mainNav")}>
          <button
            onClick={() => setTab("explore")}
            aria-label={t("notebook.anatomyExplorer")}
            className={tab === "explore" ? "active" : ""}
          >
            <Layers3 size={21} />
          </button>
          {
            <button
              onClick={() => setTab("journal")}
              aria-label={t("notebook.yourNotebook")}
              className={tab === "journal" ? "active" : ""}
            >
              <BookOpen size={20} />
            </button>
          }
        </nav>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {example ? t("notebook.eyebrowBrowser") : t("notebook.eyebrow")}
              </div>
              <h1>
                {t("notebook.heading")}<span>.</span>
              </h1>
              <p>{t("notebook.tagline")}</p>
            </div>
            <button
              className="new-map-button"
              onClick={() => void newMap()}
              disabled={busy || !hydrated}
            >
              <Plus size={17} />
              {t("notebook.newEntry")}
            </button>
          </div>
          <div className="page-tabs">
            <button
              className={tab === "explore" ? "selected" : ""}
              onClick={() => setTab("explore")}
            >
              <Layers3 size={16} />
              {t("notebook.bodyMap")}
            </button>
            {
              <button
                className={tab === "journal" ? "selected" : ""}
                onClick={() => setTab("journal")}
              >
                <BookOpen size={16} />
                {t("notebook.notebookTab")}<span className="count">{saved.length}</span>
              </button>
            }
            <span className="session-badge" role="status">
              <span />
              {t(draftStatus)}
            </span>
          </div>
          {storageError && (
            <p className="error-notice" role="alert">
              {storageError}
            </p>
          )}
          {error && (
            <div className="error-notice" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label={t("notebook.dismissError")}>
                <X size={14} />
              </button>
            </div>
          )}
          {tab === "journal" ? (
            <section className="journal">
              <div className="journal-heading">
                <h2>{t("notebook.entries")}</h2>
                <p>
                  {isNativeApp()
                    ? t("notebook.savedNative")
                    : t("notebook.savedBrowser")}
                </p>
                <div className="notebook-tools">
                  <button
                    className="secondary"
                    onClick={backup}
                    disabled={!saved.length && !valid}
                  >
                    <ArrowDownToLine size={16} />
                    {t("notebook.exportNotebook")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => importInput.current?.click()}
                    disabled={busy}
                  >
                    <Upload size={16} />
                    {t("notebook.importMap")}
                  </button>
                  <input
                    ref={importInput}
                    type="file"
                    accept=".ihm,.json,application/json"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void importFile(file);
                    }}
                  />
                </div>
              </div>
              {!saved.length ? (
                <div className="empty-journal">
                  <BookOpen size={40} />
                  <h3>{t("notebook.emptyHeading")}</h3>
                  <button className="primary" onClick={() => setTab("explore")}>
                    {t("notebook.openBodyMap")}
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="journal-grid">
                  {[...saved]
                    .sort((a, b) => b.created.localeCompare(a.created))
                    .map((item) => (
                      <article className="journal-card" key={item.id}>
                        <div className="card-overline">
                          <MapPin size={17} />
                          {formatDate(item.created)}
                          <button
                            aria-label={t("notebook.deleteEntry", { title: item.map.title })}
                            disabled={busy}
                            onClick={() => void erase(item)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <h3>{item.map.title}</h3>
                        <p>{item.note}</p>
                        <div className="region-tags">
                          {item.map.regions.map((r) => (
                            <span key={r}>{regionName(r)}</span>
                          ))}
                        </div>
                        <button
                          className="secondary"
                          onClick={() => void openSaved(item)}
                          disabled={busy}
                        >
                          {t("notebook.openEntry")}
                          <ArrowRight size={16} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            void exportFile(() => download(item, "json"))
                          }
                        >
                          {t("notebook.exportJson")}
                          <ArrowDownToLine size={14} />
                        </button>
                      </article>
                    ))}
                </div>
              )}
            </section>
          ) : (
            <div className="explorer-grid" inert={busy || !hydrated}>
              <section
                className="body-workspace"
                aria-label={t("notebook.interactiveMap")}
              >
                <div className="body-toolbar">
                  <div>
                    <span className="small-label">{t("notebook.exploreEyebrow")}</span>
                    <h2>{t("notebook.bodyMap")}</h2>
                  </div>
                  <div className="more-tools-wrap">
                    <button
                      className="secondary more-tools"
                      aria-expanded={toolsMenu}
                      aria-controls="more-tools-menu"
                      onClick={() => {
                        setToolsMenu((open) => {
                          if (open) {
                            setLandmarks(false);
                            return false;
                          }
                          setAdvancedControls(true);
                          return true;
                        });
                      }}
                    >
                      {t("notebook.moreTools")} <ChevronDown size={16} />
                    </button>
                    <div
                      id="more-tools-menu"
                      className="more-tools-menu"
                      hidden={!toolsMenu}
                    >
                      <button
                        className={landmarks ? "landmark-active" : ""}
                        onClick={() => setLandmarks((v) => !v)}
                        aria-pressed={landmarks}
                      >
                        <Crosshair size={14} />
                        {t("notebook.landmarks")}
                      </button>
                      <button
                        onClick={() => {
                          action("tools:muscle");
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        {t("notebook.muscleList")}
                      </button>
                      <button
                        onClick={() => {
                          action("tools:layers");
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        <Layers3 size={14} /> {t("notebook.layers")}
                      </button>
                      <button
                        hidden={!allowCamera}
                        onClick={() => {
                          action("tools:hands");
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        {t("notebook.hands")}
                      </button>
                      <button
                        onClick={() => {
                          setBodyReference(true);
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        {t("notebook.bodyReference")}
                      </button>
                      <div className="layer-toggle">
                        <button
                          className={layer === "muscle" ? "active" : ""}
                          aria-pressed={layer === "muscle"}
                          onClick={() => setLayer("muscle")}
                        >
                          <Layers3 size={14} />
                          {t("notebook.muscles")}
                        </button>
                        <button
                          className={layer === "bone" ? "active" : ""}
                          aria-pressed={layer === "bone"}
                          onClick={() => setLayer("bone")}
                        >
                          {t("notebook.skeleton")}
                        </button>
                      </div>
                      {layer === "muscle" && (
                        <label className="bones-toggle">
                          <input
                            type="checkbox"
                            checked={showSkeleton}
                            onChange={(event) =>
                              setShowSkeleton(event.target.checked)
                            }
                          />{" "}
                          {t("notebook.showBones")}
                        </label>
                      )}
                      {landmarks && (
                        <div className="landmark-content">
                          <div className="landmark-breadcrumb">
                            <button
                              onClick={() => {
                                setSelected(null);
                                action("reset");
                              }}
                            >
                              {t("notebook.body")}
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
                                {regionName(a.region)}
                                <ChevronRight size={12} />
                              </button>
                            ))
                          ) : (
                            <>
                              <div className="surface-buttons">
                                {[
                                  ["anterior", t("notebook.surface.front")],
                                  ["posterior", t("notebook.surface.back")],
                                  ["superior", t("notebook.surface.top")],
                                  ["lateral", t("notebook.surface.outer")],
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
                              <span className="small-label">{t("notebook.muscleGroups")}</span>
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
                                {t("notebook.showContext")}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="anatomy-stage">
                  <div className="stage-grid" />
                  <div className="stage-intro">
                    <button onClick={openRegions}>
                      <Search size={14} />
                      {t("notebook.findRegion")}
                    </button>
                  </div>
                  <FeatureBoundary label={t("notebook.view3d")}>
                    <Suspense
                      fallback={
                        <div className="canvas-loading">
                          {t("notebook.loadingAnatomy")}
                          <span />
                        </div>
                      }
                    >
                      <Anatomy
                        navigation
                        advancedControls={advancedControls}
                        captureRef={capture}
                        selected={selected}
                        mapped={result?.regions ?? noRegions}
                        intensity={result?.intensity ?? null}
                        layer={layer}
                        showSkeleton={showSkeleton}
                        onOrientation={setOrientation}
                        view={view}
                        command={command}
                        onSelect={setSelected}
                        proposed={proposedPin}
                        points={points}
                        onPoint={(point) => {
                          setPoints((old) => [...old, point]);
                        }}
                        handEntry={{
                          entryId: entry.id,
                          onIntensity: (value) => context("intensity", value),
                          onSave: commit,
                          onRemovePin: (id) =>
                            setPoints((old) =>
                              old.filter((point) => point.id !== id),
                            ),
                        }}
                      />
                    </Suspense>
                  </FeatureBoundary>
                  <div className="view-switch" aria-label={t("notebook.orientation")}>
                    <button
                      aria-pressed={orientation === "front"}
                      className={orientation === "front" ? "active" : ""}
                      onClick={() => {
                        setView("front");
                        action("view");
                      }}
                    >
                      {t("notebook.view.front")}
                    </button>
                    <button
                      aria-pressed={orientation === "back"}
                      className={orientation === "back" ? "active" : ""}
                      onClick={() => {
                        setView("back");
                        action("view");
                      }}
                    >
                      {t("notebook.view.back")}
                    </button>
                  </div>
                  <div className="canvas-controls">
                    <button
                      onClick={() => action("zoom-in")}
                      aria-label={t("notebook.zoomIn")}
                    >
                      <Plus size={18} />
                    </button>
                    <button
                      onClick={() => action("zoom-out")}
                      aria-label={t("notebook.zoomOut")}
                    >
                      <Minus size={18} />
                    </button>
                    <span />
                    <button
                      onClick={() => action("reset")}
                      aria-label={t("notebook.resetView")}
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                  <div className="anatomy-bottom">
                    <span>{t("notebook.referenceBody")}</span>
                    <a
                      href="/models/ATTRIBUTION.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("notebook.anatomyCredits")}
                    </a>
                  </div>
                </div>
                {selected && (
                  <div className="region-callout">
                    <span
                      className={
                        proposedPin === selected
                          ? "callout-dot proposed"
                          : "callout-dot"
                      }
                    />
                    <div>
                      <span>
                        {proposedPin === selected
                          ? t("notebook.callout.proposed")
                          : result?.regions.includes(selected)
                            ? t("notebook.callout.reported")
                            : t("notebook.callout.selected")}
                      </span>
                      <strong>{regionName(selected)}</strong>
                    </div>
                    {proposedPin === selected ? (
                      <>
                        <button
                          onClick={() => proposal({ type: "confirm" })}
                          aria-label={t("notebook.confirmPinLabel")}
                        >
                          <Plus size={14} /> {t("notebook.confirmPin")}
                        </button>
                        <button
                          onClick={() => proposal({ type: "dismiss" })}
                          aria-label={t("notebook.dismissPinLabel")}
                        >
                          <span>{t("notebook.dismiss")}</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          title={t("notebook.focusTitle")}
                          aria-label={t("notebook.focusLabel")}
                          onClick={() => action("focus")}
                        >
                          <span>{t("notebook.focus")}</span>
                        </button>
                        <button
                          onClick={() => action("pin-center")}
                          aria-label={t("notebook.addPinLabel")}
                        >
                          <Plus size={14} /> {t("notebook.addPin")}
                        </button>
                      </>
                    )}
                    <button
                      title={t("notebook.clearSelection")}
                      aria-label={t("notebook.clearSelection")}
                      onClick={() => setSelected(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="body-footer">
                  {bodyReference && (
                    <Suspense fallback={<span>{t("notebook.loadingReference")}</span>}>
                      <BodyReference onClose={() => setBodyReference(false)} />
                    </Suspense>
                  )}
                  <div className="heat-legend">
                    <span>
                      {result?.intensity != null
                        ? t("notebook.legend.intensity")
                        : t("notebook.legend.area")}
                    </span>
                    <div />
                    <span>
                      {result?.intensity != null ? t("notebook.legend.mild") : t("notebook.legend.location")}
                    </span>
                    <span>
                      {result?.intensity != null ? t("notebook.legend.strong") : t("notebook.legend.unrated")}
                    </span>
                  </div>
                </div>
                {result && (
                  <details className="offline-reading">
                    <summary>{t("notebook.offlineReading")}</summary>
                    <Resources
                      region={selected ?? result?.regions[0] ?? null}
                      activity={`${note} ${result?.activity ?? ""}`}
                      urgent={result?.urgent ?? false}
                      selectedSources={readingSources}
                      onSources={setReadingSources}
                    />
                  </details>
                )}
              </section>
              <aside className="intake-panel">
                <div className="intake-header">
                  <span className="spark-icon">
                    <BookOpen size={17} />
                  </span>
                  <div>
                    <h2>{t("notebook.yourEntry")}</h2>
                    <p>{t("notebook.yourWords")}</p>
                  </div>
                </div>
                <div className="intake-content">
                  <label className="field-label" htmlFor="entry-title">
                    {t("notebook.title")} <span>{t("notebook.optional")}</span>
                  </label>
                  <input
                    className="notebook-input"
                    id="entry-title"
                    value={entry.map.title}
                    placeholder={result.title}
                    maxLength={200}
                    onChange={(e) => context("title", e.target.value)}
                  />
                  <label className="field-label" htmlFor="activity">
                    {t("notebook.activity")} <span>{t("notebook.optional")}</span>
                  </label>
                  <input
                    className="notebook-input"
                    id="activity"
                    list="activity-list"
                    autoComplete="off"
                    value={entry.map.activity}
                    placeholder={t("notebook.activityPlaceholder")}
                    maxLength={200}
                    onChange={(e) => context("activity", e.target.value)}
                  />
                  <datalist id="activity-list">
                    {activities.map((a) => (
                      <option key={a.name} value={activityName(a)} />
                    ))}
                  </datalist>
                  {!!activityRegions(entry.map.activity).length && (
                    <details className="activity-explore">
                      <summary>{t("notebook.exploreActivity")}</summary>
                      <div className="region-tags">
                        {activityRegions(entry.map.activity).map((id) => (
                          <button
                            key={id}
                            onClick={() => {
                              selectRegion(id);
                              action("focus");
                            }}
                          >
                            {regionName(id)}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                  <label className="field-label" htmlFor="pain-note">
                    {t("notebook.notice")}
                  </label>
                  <div className="note-field">
                    <textarea
                      id="pain-note"
                      aria-label={t("notebook.describe")}
                      value={note}
                      onChange={(e) => change({ note: e.target.value })}
                      placeholder={t("notebook.notePlaceholder")}
                      rows={5}
                      maxLength={3000}
                    />
                    <div className="note-tools">
                      {VoiceInput && (
                        <VoiceInput
                          entry={entry}
                          onApply={(draft) => {
                            const next = applyVoiceDraft(entry, draft);
                            change({ note: next.note, map: next.map });
                            if (draft.region) {
                              selectRegion(draft.region);
                              action("focus");
                              if (draft.proposePin)
                                setProposedPin(
                                  proposedPinStep(null, {
                                    type: "propose",
                                    region: draft.region,
                                  }).state,
                                );
                            }
                            setToast(
                              t("notebook.toast.voiceAdded"),
                            );
                          }}
                        />
                      )}
                      <span>{note.length}/3000</span>
                    </div>
                  </div>
                  <IntensityDial
                    value={entry.map.intensity}
                    onChange={(value) => context("intensity", value)}
                  />
                  <div className="mark-history" aria-label={t("notebook.markHistory")}>
                    <span>{t("notebook.pinsHighlights")}</span>
                    <button
                      disabled={!markHistory.current.canUndo}
                      aria-label={t("notebook.undoMark")}
                      onClick={() => {
                        const restored = markHistory.current.undo(points);
                        setPoints(() => restored, false);
                      }}
                    >
                      <Undo2 size={14} /> {t("notebook.undo")}
                    </button>
                    <button
                      disabled={!markHistory.current.canRedo}
                      aria-label={t("notebook.redoMark")}
                      onClick={() => {
                        const restored = markHistory.current.redo(points);
                        setPoints(() => restored, false);
                      }}
                    >
                      <Redo2 size={14} /> {t("notebook.redo")}
                    </button>
                  </div>
                  {points.length > 0 && (
                    <div className="pin-list">
                      <span className="small-label">
                        {t("notebook.pinnedSpots", { count: points.length })}
                      </span>
                      {points.map((point, i) => (
                        <div className="notebook-pin" key={point.id}>
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
                            className="pin-layers"
                            aria-label={t("notebook.spotLayers", { n: i + 1 })}
                            onClick={() => {
                              setSelected(point.region);
                              action("layers:" + point.id);
                              document
                                .querySelector(".anatomy-stage")
                                ?.scrollIntoView({
                                  block: "center",
                                  behavior: "instant",
                                });
                            }}
                          >
                            <Layers3 size={14} />
                          </button>
                          <button
                            aria-label={t("notebook.spotRemove", { n: i + 1 })}
                            onClick={() =>
                              setPoints((old) =>
                                old.filter((p) => p.id !== point.id),
                              )
                            }
                          >
                            <X size={13} />
                          </button>
                          <textarea
                            aria-label={t("notebook.spotNote", { n: i + 1 })}
                            placeholder={t("notebook.spotPlaceholder")}
                            value={point.comment ?? ""}
                            maxLength={1000}
                            rows={2}
                            onChange={(e) =>
                              setPoints(
                                (old) =>
                                  old.map((p) =>
                                    p.id === point.id
                                      ? { ...p, comment: e.target.value }
                                      : p,
                                  ),
                                false,
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <details className="entry-context">
                    <summary>
                      {t("notebook.moreContext")} <span>{t("notebook.optional")}</span>
                    </summary>
                    <label className="field-label" htmlFor="quality">
                      {t("notebook.feeling")}
                    </label>
                    <input
                      className="notebook-input"
                      id="quality"
                      value={entry.map.quality}
                      placeholder={t("notebook.feelingPlaceholder")}
                      maxLength={200}
                      onChange={(e) => context("quality", e.target.value)}
                    />
                    <label className="field-label" htmlFor="duration">
                      {t("notebook.timing")}
                    </label>
                    <input
                      className="notebook-input"
                      id="duration"
                      value={entry.map.duration}
                      placeholder={t("notebook.timingPlaceholder")}
                      maxLength={200}
                      onChange={(e) => context("duration", e.target.value)}
                    />
                  </details>
                  {Research && (
                    <Research
                      key={entry.id}
                      entry={currentEntry()}
                      sources={readingSources}
                      onSave={async (research) => {
                        const updated = await saveResearch(entry.id, research);
                        if (!updated)
                          throw Error(
                            t("notebook.error.removedDuringSearch"),
                          );
                        setEntry((e) =>
                          e.id === entry.id
                            ? {
                                ...e,
                                research,
                                updated: new Date().toISOString(),
                              }
                            : e,
                        );
                        setSaved((old) => [
                          ...old.filter((e) => e.id !== updated.id),
                          updated,
                        ]);
                      }}
                    />
                  )}
                  <div className="report-actions">
                    <button
                      className="primary"
                      onClick={() => void commit()}
                      disabled={!valid || busy}
                    >
                      <Check size={16} />
                      {t("notebook.saveEntry")}
                      <ArrowRight size={16} />
                    </button>
                    <div className="export-pair">
                      <button
                        className="secondary"
                        onClick={() =>
                          void exportFile(() =>
                            download(currentEntry(), "json"),
                          )
                        }
                        disabled={!valid}
                      >
                        <ArrowDownToLine size={16} />
                        {t("notebook.exportJson")}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const image = capture.current?.();
                          if (image)
                            void exportFile(() =>
                              downloadViewport(image, entry.created),
                            );
                          else
                            setError(
                              t("notebook.error.viewNotReady"),
                            );
                        }}
                        disabled={!valid}
                      >
                        {t("notebook.mapImage")}
                        <ArrowDownToLine size={16} />
                      </button>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        (() => {
                          const reading =
                            document.querySelector<HTMLDetailsElement>(
                              ".offline-reading",
                            );
                          if (reading) reading.open = true;
                          reading?.scrollIntoView({
                            behavior: window.matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "instant"
                              : "smooth",
                            block: "start",
                          });
                        })()
                      }
                    >
                      <BookOpen size={15} />
                      {t("notebook.offlineReading")}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <button
                    className="text-button"
                    disabled={!valid}
                    onClick={() => {
                      if (isNativeApp()) {
                        void exportFile(() =>
                          downloadReport(
                            currentEntry(),
                            capture.current?.() ?? undefined,
                          ),
                        );
                        return;
                      }
                      if (
                        !printMap(
                          currentEntry(),
                          capture.current?.() ?? undefined,
                        )
                      )
                        setError(
                          t("notebook.error.printBlocked"),
                        );
                    }}
                  >
                    {isNativeApp() ? t("notebook.shareReport") : t("notebook.printPdf")}
                    <ArrowUpRight size={14} />
                  </button>
                  <ShareWithAI entry={currentEntry()} valid={valid} />
                  {entry.ai && (
                    <details className="saved-ai">
                      <summary>{t("notebook.savedAiNote", { provider: entry.ai.provider })}</summary>
                      {entry.ai.based_on !== entryFingerprint(entry) && (
                        <p className="subtle">
                          {t("notebook.aiStale")}
                        </p>
                      )}
                      <p>{entry.ai.map.summary}</p>
                      {entry.ai.map.safety_message && (
                        <p>{entry.ai.map.safety_message}</p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => change({ ai: undefined })}
                      >
                        {t("notebook.removeAiNote")}
                      </button>
                    </details>
                  )}
                  {Assistant && (
                    <FeatureBoundary label={t("notebook.aiTools")}>
                      <Assistant
                        key={entry.id}
                        entry={currentEntry()}
                        onSave={(ai) =>
                          setEntry((e) =>
                            e.id === entry.id
                              ? { ...e, ai, updated: new Date().toISOString() }
                              : e,
                          )
                        }
                        onNote={(text) => change({ note: text.slice(0, 3000) })}
                      />
                    </FeatureBoundary>
                  )}
                  <div className="intake-footnote">
                    <LockKeyhole size={13} />
                    <span>
                      {t("notebook.storedHere")}
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          )}
          <footer className="page-footer">
            <Feedback />
            <span>
              <ShieldCheck size={13} />
              {t("notebook.footerDisclaimer")}
            </span>
            <span className="creator-credit">
              {t("notebook.madeBy")}{" "}
              <a
                href="https://x.com/msxndborn"
                target="_blank"
                rel="noreferrer"
              >
                @msxndborn
              </a>
            </span>
            <button onClick={() => infoDialog.current?.showModal()}>
              {t("notebook.privacyLimitations")}
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {tutorial && <Tutorial onClose={() => setTutorial(false)} />}
      <dialog ref={regionDialog} className="dialog region-dialog">
        <div className="dialog-heading">
          <h2>{t("notebook.regionDialog")}</h2>
          <button
            onClick={() => regionDialog.current?.close()}
            aria-label={t("notebook.closeRegions")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="region-search">
          <Search size={17} />
          <input
            ref={regionSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("notebook.regionSearch")}
            aria-label={t("notebook.regionSearchLabel")}
          />
        </div>
        <p className="dialog-caption">{t("notebook.regionCaption")}</p>
        <div className="region-list">
          {regions
            .filter((r) => regionMatches(r.id, search))
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
      <dialog
        ref={infoDialog}
        className="dialog info-dialog"
        aria-labelledby="notebook-info-title"
      >
        <div className="dialog-heading">
          <h2 id="notebook-info-title">{t("notebook.info.title")}</h2>
          <button
            onClick={() => infoDialog.current?.close()}
            aria-label={t("notebook.info.close")}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          {isNativeApp()
            ? t("notebook.info.storageNative")
            : t("notebook.info.storageBrowser")}
        </p>
        <p>
          {t("notebook.info.ai")}
        </p>
        {isNativeApp() && (
          <>
            <p>
              {t("notebook.info.native")}
            </p>
            <p>
              {t("notebook.info.exports")}
            </p>
          </>
        )}
        <p>
          {t("notebook.info.medical")}
        </p>
        <p>
          {t("notebook.info.resources")}
        </p>
        <a
          href="https://github.com/sandbornm/ihurt/blob/main/docs/SAFETY.md"
          target="_blank"
          rel="noreferrer"
        >
          {t("notebook.info.safetyLink")}
        </a>
        <FeedbackLinks />
        <AnatomyCredits />
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          {removed && (
            <button onClick={() => void undoDelete()}>
              {t("notebook.undoDelete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
