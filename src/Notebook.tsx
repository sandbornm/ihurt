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
  regions,
  type RegionId,
  type SavedMap,
  type PainPoint,
} from "./types";
import {
  download,
  downloadNotebook,
  downloadViewport,
  printMap,
} from "./export";
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
import { activities, activityRegions } from "./activities";
import { exampleEntry } from "./example";
import { prepareOffline } from "./offline";
import FeatureBoundary from "./FeatureBoundary";
import Resources from "./Resources";
import IntensityDial from "./IntensityDial";
import ThemeToggle from "./ThemeToggle";
import Tutorial from "./Tutorial";
import ShareWithAI from "./sharing/ShareWithAI";
import { MarkHistory } from "./anatomy/history";
import { recommendedSources, findReadings, sources } from "./reading";
import { bodyAnchors, muscleGroups } from "./anatomy/landmarks";
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
}: {
  example?: boolean;
  allowCamera?: boolean;
  Assistant?: ComponentType<AssistantProps>;
  Research?: ComponentType<{
    entry: SavedMap;
    sources: string[];
    onSave: (research: NonNullable<SavedMap["research"]>) => Promise<void>;
  }>;
}) {
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
  const [command, setCommand] = useState({ type: "", id: 0 }),
    [landmarks, setLandmarks] = useState(false);
  const [readingSources, setReadingSources] = useState(recommendedSources);
  const [search, setSearch] = useState(""),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false),
    [draftStatus, setDraftStatus] = useState("Opening notebook…"),
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
            "Browser storage is unavailable. You can still write and export this entry.",
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
    setDraftStatus("Saving draft…");
    const persist = () =>
      saveDraft(draftRef.current)
        .then(() => {
          if (!cancelled) {
            setDraftStatus("Draft saved on this device");
            setStorageError("");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDraftStatus("Draft not saved");
            setStorageError(
              "This browser could not save your draft. Export JSON to keep it.",
            );
          }
        });
    const timer = setTimeout(() => {
      void persist();
    }, 280);
    const flush = () => {
      void saveDraft(draftRef.current);
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
    if (!valid || busy) return;
    const item = currentEntry();
    setBusy(true);
    setError("");
    try {
      await storeEntries([item]);
      setSaved((old) => [...old.filter((e) => e.id !== item.id), item]);
      setToast("Entry saved on this device.");
    } catch {
      setError(
        "The entry could not be saved here. Export JSON to keep a copy.",
      );
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
        setError("Save or export this draft before starting another entry.");
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
        "Export or save your current draft before opening another entry.",
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
      setToast("Entry deleted.");
      if (entry.id === item.id) {
        setEntry(blankEntry());
        setSelected(null);
      }
    } catch {
      setError("The entry could not be deleted.");
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
      setToast("Entry restored.");
    } catch {
      setError("The entry could not be restored.");
    }
  }
  async function importFile(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose an export smaller than 10 MB.");
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
        `Imported ${additions.length} ${additions.length === 1 ? "entry" : "entries"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import this file.");
    } finally {
      setBusy(false);
    }
  }
  function backup() {
    const records = new Map(saved.map((e) => [e.id, e]));
    if (valid) records.set(entry.id, currentEntry());
    downloadNotebook([...records.values()]);
  }
  return (
    <div
      className="app-shell notebook-shell"
      data-offline={offline ? "ready" : "preparing"}
    >
      <header className="topbar">
        <a href={example ? "/" : "#"} className="brand" aria-label="iHurt home">
          <span className="brand-mark">
            <img src="/favicon.svg" width="34" height="34" alt="" />
          </span>
          iHurt<span className="brand-period">.</span>
        </a>
        <div className="top-actions">
          <ThemeToggle />
          <button
            className="privacy-link tour-button"
            onClick={() => setTutorial(true)}
          >
            <CircleHelp size={18} /> Quick tour
          </button>
          {example && (
            <a
              className="privacy-link"
              href="https://github.com/sandbornm/ihurt"
            >
              Get the notebook ↗
            </a>
          )}
          <button
            className="privacy-link"
            onClick={() => infoDialog.current?.showModal()}
          >
            <CircleHelp size={17} />
            <span>About & privacy</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <nav className="rail" aria-label="Main navigation">
          <button
            onClick={() => setTab("explore")}
            aria-label="Anatomy explorer"
            className={tab === "explore" ? "active" : ""}
          >
            <Layers3 size={21} />
          </button>
          {
            <button
              onClick={() => setTab("journal")}
              aria-label="Your notebook"
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
                {example ? "YOUR BROWSER NOTEBOOK" : "YOUR NOTEBOOK"}
              </div>
              <h1>
                Map how you feel<span>.</span>
              </h1>
              <p>Pin the spots. Keep the context.</p>
            </div>
            <button
              className="new-map-button"
              onClick={() => void newMap()}
              disabled={busy || !hydrated}
            >
              <Plus size={17} />
              New entry
            </button>
          </div>
          <div className="page-tabs">
            <button
              className={tab === "explore" ? "selected" : ""}
              onClick={() => setTab("explore")}
            >
              <Layers3 size={16} />
              Body map
            </button>
            {
              <button
                className={tab === "journal" ? "selected" : ""}
                onClick={() => setTab("journal")}
              >
                <BookOpen size={16} />
                Notebook<span className="count">{saved.length}</span>
              </button>
            }
            <span className="session-badge" role="status">
              <span />
              {draftStatus}
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
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          )}
          {tab === "journal" ? (
            <section className="journal">
              <div className="journal-heading">
                <h2>Your entries</h2>
                <p>
                  Saved in this browser. Export a backup before clearing browser
                  data or changing devices.
                </p>
                <div className="notebook-tools">
                  <button
                    className="secondary"
                    onClick={backup}
                    disabled={!saved.length && !valid}
                  >
                    <ArrowDownToLine size={16} />
                    Export notebook
                  </button>
                  <button
                    className="secondary"
                    onClick={() => importInput.current?.click()}
                    disabled={busy}
                  >
                    <Upload size={16} />
                    Import map
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
                  <h3>Your first entry starts with a spot.</h3>
                  <button className="primary" onClick={() => setTab("explore")}>
                    Open body map
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
                          {new Date(item.created).toLocaleDateString()}
                          <button
                            aria-label={`Delete ${item.map.title}`}
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
                          Open entry
                          <ArrowRight size={16} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() => download(item, "json")}
                        >
                          Export JSON
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
                aria-label="Interactive body map"
              >
                <div className="body-toolbar">
                  <div>
                    <span className="small-label">EXPLORE YOUR ANATOMY</span>
                    <h2>Body map</h2>
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
                      More tools <ChevronDown size={16} />
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
                        Landmarks
                      </button>
                      <button
                        onClick={() => {
                          action("tools:muscle");
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        Muscle list
                      </button>
                      <button
                        onClick={() => {
                          action("tools:layers");
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        <Layers3 size={14} /> Layers
                      </button>
                      <button
                        hidden={!allowCamera}
                        onClick={() => {
                          action("tools:hands");
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        Hands
                      </button>
                      <button
                        onClick={() => {
                          setBodyReference(true);
                          setToolsMenu(false);
                          setLandmarks(false);
                        }}
                      >
                        Body reference
                      </button>
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
                      {layer === "muscle" && (
                        <label className="bones-toggle">
                          <input
                            type="checkbox"
                            checked={showSkeleton}
                            onChange={(event) =>
                              setShowSkeleton(event.target.checked)
                            }
                          />{" "}
                          Show bones
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
                  </div>
                </div>
                <div className="anatomy-stage">
                  <div className="stage-grid" />
                  <div className="stage-intro">
                    <button onClick={openRegions}>
                      <Search size={14} />
                      Find a region
                    </button>
                  </div>
                  <FeatureBoundary label="The 3D view">
                    <Suspense
                      fallback={
                        <div className="canvas-loading">
                          Loading anatomy…
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
                        points={points}
                        onPoint={(point) => {
                          setPoints((old) => [...old, point]);
                        }}
                      />
                    </Suspense>
                  </FeatureBoundary>
                  <div className="view-switch" aria-label="Body orientation">
                    <button
                      aria-pressed={orientation === "front"}
                      className={orientation === "front" ? "active" : ""}
                      onClick={() => {
                        setView("front");
                        action("view");
                      }}
                    >
                      Front
                    </button>
                    <button
                      aria-pressed={orientation === "back"}
                      className={orientation === "back" ? "active" : ""}
                      onClick={() => {
                        setView("back");
                        action("view");
                      }}
                    >
                      Back
                    </button>
                  </div>
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
                    <span>Reference body · your left and right</span>
                    <a
                      href="/models/ATTRIBUTION.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Anatomy credits ↗
                    </a>
                  </div>
                </div>
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
                      <span>Focus</span>
                    </button>
                    <button
                      onClick={() => action("pin-center")}
                      aria-label="Add pin in selected region"
                    >
                      <Plus size={14} /> Add pin
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
                <div className="body-footer">
                  {bodyReference && (
                    <Suspense fallback={<span>Loading reference…</span>}>
                      <BodyReference onClose={() => setBodyReference(false)} />
                    </Suspense>
                  )}
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
                {result && (
                  <details className="offline-reading">
                    <summary>Offline reading</summary>
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
                    <h2>Your entry</h2>
                    <p>Your words, saved with your map.</p>
                  </div>
                </div>
                <div className="intake-content">
                  <label className="field-label" htmlFor="entry-title">
                    Title <span>optional</span>
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
                    Sport or activity <span>optional</span>
                  </label>
                  <input
                    className="notebook-input"
                    id="activity"
                    list="activity-list"
                    autoComplete="off"
                    value={entry.map.activity}
                    placeholder="Search or type anything"
                    maxLength={200}
                    onChange={(e) => context("activity", e.target.value)}
                  />
                  <datalist id="activity-list">
                    {activities.map((a) => (
                      <option key={a.name} value={a.name} />
                    ))}
                  </datalist>
                  {!!activityRegions(entry.map.activity).length && (
                    <details className="activity-explore">
                      <summary>Explore anatomy for this activity</summary>
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
                    What do you notice?
                  </label>
                  <div className="note-field">
                    <textarea
                      id="pain-note"
                      aria-label="Describe your discomfort"
                      value={note}
                      onChange={(e) => change({ note: e.target.value })}
                      placeholder="Where it feels stiff, what brings it on, what changed…"
                      rows={5}
                      maxLength={3000}
                    />
                    <div className="note-tools">
                      <span>{note.length}/3000</span>
                    </div>
                  </div>
                  <IntensityDial
                    value={entry.map.intensity}
                    onChange={(value) => context("intensity", value)}
                  />
                  <div className="mark-history" aria-label="Undo map changes">
                    <span>Pins & highlights</span>
                    <button
                      disabled={!markHistory.current.canUndo}
                      aria-label="Undo last mark"
                      onClick={() => {
                        const restored = markHistory.current.undo(points);
                        setPoints(() => restored, false);
                      }}
                    >
                      <Undo2 size={14} /> Undo
                    </button>
                    <button
                      disabled={!markHistory.current.canRedo}
                      aria-label="Redo last mark"
                      onClick={() => {
                        const restored = markHistory.current.redo(points);
                        setPoints(() => restored, false);
                      }}
                    >
                      <Redo2 size={14} /> Redo
                    </button>
                  </div>
                  {points.length > 0 && (
                    <div className="pin-list">
                      <span className="small-label">
                        PINNED SPOTS · {points.length}
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
                            aria-label={`Explore layers at spot ${i + 1}`}
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
                            aria-label={`Remove spot ${i + 1}`}
                            onClick={() =>
                              setPoints((old) =>
                                old.filter((p) => p.id !== point.id),
                              )
                            }
                          >
                            <X size={13} />
                          </button>
                          <textarea
                            aria-label={`Note for spot ${i + 1}`}
                            placeholder="A note for this spot…"
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
                      More context <span>optional</span>
                    </summary>
                    <label className="field-label" htmlFor="quality">
                      Feeling
                    </label>
                    <input
                      className="notebook-input"
                      id="quality"
                      value={entry.map.quality}
                      placeholder="Stiff, sore, tingling…"
                      maxLength={200}
                      onChange={(e) => context("quality", e.target.value)}
                    />
                    <label className="field-label" htmlFor="duration">
                      Timing
                    </label>
                    <input
                      className="notebook-input"
                      id="duration"
                      value={entry.map.duration}
                      placeholder="Since yesterday, after 20 minutes…"
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
                            "This entry was removed before the search finished.",
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
                      Save entry
                      <ArrowRight size={16} />
                    </button>
                    <div className="export-pair">
                      <button
                        className="secondary"
                        onClick={() => download(currentEntry(), "json")}
                        disabled={!valid}
                      >
                        <ArrowDownToLine size={16} />
                        Export JSON
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const image = capture.current?.();
                          if (image) downloadViewport(image, entry.created);
                          else
                            setError(
                              "The 3D view is not ready for a picture yet.",
                            );
                        }}
                        disabled={!valid}
                      >
                        Map image
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
                      Offline reading
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <button
                    className="text-button"
                    disabled={!valid}
                    onClick={() => {
                      if (
                        !printMap(
                          currentEntry(),
                          capture.current?.() ?? undefined,
                        )
                      )
                        setError(
                          "Allow the print window, or download the map image to print it.",
                        );
                    }}
                  >
                    Print / Save PDF
                    <ArrowUpRight size={14} />
                  </button>
                  <ShareWithAI entry={currentEntry()} valid={valid} />
                  {entry.ai && (
                    <details className="saved-ai">
                      <summary>Saved AI note · {entry.ai.provider}</summary>
                      {entry.ai.based_on !== entryFingerprint(entry) && (
                        <p className="subtle">
                          This review was made before your latest edits.
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
                        Remove AI note
                      </button>
                    </details>
                  )}
                  {Assistant && (
                    <FeatureBoundary label="Optional AI tools">
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
                      Stored on this device. Export a backup to keep elsewhere.
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />A personal journal. Not medical advice.
            </span>
            <span className="creator-credit">
              Made by{" "}
              <a
                href="https://x.com/msxndborn"
                target="_blank"
                rel="noreferrer"
              >
                @msxndborn
              </a>
            </span>
            <button onClick={() => infoDialog.current?.showModal()}>
              Privacy & limitations
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {tutorial && <Tutorial onClose={() => setTutorial(false)} />}
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
            ref={regionSearch}
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
          <h2>Your notebook, your data</h2>
          <button
            onClick={() => infoDialog.current?.close()}
            aria-label="Close information"
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Entries and drafts are stored in this browser on your device. They
          survive refreshes. Clearing browser data or using a private window can
          remove them; export backups you want to keep. The app does not encrypt
          browser storage.
        </p>
        <p>
          Nothing is sent to an AI unless you choose to share or use the
          optional tools. Downloads contain your notes and pins.
        </p>
        <p>
          iHurt is not medical advice whatsoever. It does not diagnose, treat,
          cure, mitigate, or prevent any disease, injury, or condition. Anatomy
          labels and highlights are approximate. Pins refer to a shared anatomy
          model, not measurements of your body. Height and weight alone cannot
          establish your proportions or the tissue causing discomfort.
        </p>
        <p>
          Linked resources are published independently and may change. Inclusion
          does not imply endorsement or a personal exercise recommendation.
        </p>
        <a
          href="https://github.com/sandbornm/ihurt/blob/main/docs/SAFETY.md"
          target="_blank"
          rel="noreferrer"
        >
          Privacy and limitations ↗
        </a>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          {removed && (
            <button onClick={() => void undoDelete()}>Undo delete</button>
          )}
        </div>
      )}
    </div>
  );
}
