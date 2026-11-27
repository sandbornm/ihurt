import type { PainPoint, SavedMap } from "../types.ts";

export const BACKUP_DAYS = 90;
export const FREE_SEARCHES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupEntry {
  id: string;
  created: string;
  updated?: string;
  noteUpdated?: string;
}

export function withinBackupWindow(
  entry: Pick<BackupEntry, "created">,
  now: number,
  days = BACKUP_DAYS,
): boolean {
  const stamp = Date.parse(entry.created);
  if (!Number.isFinite(stamp)) return false;
  // The free window is the past bound only. A device clock that is behind
  // must not treat today's cloud entries as future and delete them on upload.
  return stamp >= now - days * DAY_MS;
}

// A device clock that is behind still has to see the server's window. The
// newest stamp in the pull is the later clock, up to ten days ahead. A further
// stamp is a fast or wrong clock; following it would age this device's current
// notes out of the upload.
const CLOCK_AHEAD_MS = 10 * DAY_MS;

export function backupClock<T extends BackupEntry>(
  now: number,
  remote: readonly T[],
): number {
  let latest = now;
  const cap = now + CLOCK_AHEAD_MS;
  for (const entry of remote) {
    const stamps = [
      entry.created,
      entry.updated,
      entry.noteUpdated,
      (entry as T & { pointsUpdated?: unknown }).pointsUpdated,
    ];
    for (const value of stamps) {
      if (typeof value !== "string") continue;
      const stamp = Date.parse(value);
      if (!Number.isFinite(stamp) || stamp <= latest) continue;
      latest = stamp < cap ? stamp : cap;
    }
  }
  return latest;
}

// A missing id is not a delete. Another device can upload an older full list
// and leave this device's note out. Only an id the server names in `deleted`
// is removed, and only while it is still inside the backup window. A new local
// row was never uploaded, so it is not in `synced`. A row older than the
// window stays on this device.
export function idsDeletedOnServer<T extends BackupEntry>(
  synced: readonly string[],
  local: readonly T[],
  namedDeleted: readonly string[],
  deleted: ReadonlySet<string>,
  now: number,
  days = BACKUP_DAYS,
): string[] {
  const named = new Set(namedDeleted);
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  return synced.filter((id) => {
    if (!named.has(id) || deleted.has(id)) return false;
    const entry = localById.get(id);
    return entry !== undefined && withinBackupWindow(entry, now, days);
  });
}

export function entriesForBackup<T extends BackupEntry>(
  entries: readonly T[],
  now: number,
  days = BACKUP_DAYS,
  keep: ReadonlySet<string> = new Set(),
): T[] {
  return entries.filter(
    (entry) => keep.has(entry.id) || withinBackupWindow(entry, now, days),
  );
}

function stampMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// The note stamp decides the row. A missing stamp is older than a present one.
// When the note stamps match, a newer row stamp wins. Otherwise this device's
// row stays. Remote-only rows stay, so the upload is not limited to the list
// this device had before the pull.
function preferBackupRow<T extends BackupEntry>(local: T, remote: T): T {
  const localNote = stampMs(local.noteUpdated);
  const remoteNote = stampMs(remote.noteUpdated);
  if (remoteNote !== localNote) return remoteNote > localNote ? remote : local;
  if (stampMs(remote.updated) > stampMs(local.updated)) return remote;
  return local;
}

// The merged rows replace the same id from this device. Local-only rows stay.
// A deleted id is left out. The caller supplies the fieldwise merge.
export function backupRowsAfterMerge<T extends BackupEntry>(
  local: readonly T[],
  merged: readonly T[],
  deleted: ReadonlySet<string> = new Set(),
): T[] {
  const byId = new Map<string, T>();
  for (const entry of local) {
    if (!deleted.has(entry.id)) byId.set(entry.id, entry);
  }
  for (const entry of merged) {
    if (!deleted.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

function readStamp(entry: BackupEntry): string | undefined {
  const value = (entry as BackupEntry & { pointsUpdated?: unknown })
    .pointsUpdated;
  return typeof value === "string" ? value : undefined;
}

function readNote(entry: BackupEntry): string | undefined {
  const value = (entry as BackupEntry & { note?: unknown }).note;
  return typeof value === "string" ? value : undefined;
}

// Notes follow noteUpdated. Pins follow pointsUpdated. A missing stamp is older.
// Remote-only rows in the window stay, so another device's new entry is not dropped.
export function mergeBackupWindow<T extends BackupEntry>(
  local: readonly T[],
  remote: readonly T[],
  deleted: ReadonlySet<string>,
  now: number,
  days = BACKUP_DAYS,
): T[] {
  const byId = new Map<string, T>();
  // The pull is the server's window. This device's clock does not expire a
  // row the server still returned.
  for (const entry of remote) {
    if (!deleted.has(entry.id)) byId.set(entry.id, entry);
  }
  for (const entry of local) {
    if (deleted.has(entry.id)) continue;
    const previous = byId.get(entry.id);
    if (!previous && !withinBackupWindow(entry, now, days)) continue;
    byId.set(entry.id, previous ? mergeBackupRow(entry, previous) : entry);
  }
  return [...byId.values()];
}

function mergeBackupRow<T extends BackupEntry>(local: T, remote: T): T {
  const noteFromRemote =
    stampMs(remote.noteUpdated) > stampMs(local.noteUpdated);
  const pinsFromRemote = stampMs(readStamp(remote)) > stampMs(readStamp(local));
  const row = { ...(noteFromRemote ? remote : local) } as T & {
    note?: string;
    points?: unknown;
    pointsUpdated?: string;
    map?: { regions?: unknown; summary?: string; title?: string };
  };
  const pins = (pinsFromRemote ? remote : local) as typeof row;
  const note = readNote(noteFromRemote ? remote : local);
  const title = noteFromRemote ? remoteMapTitle(remote) : remoteMapTitle(local);
  // A newer pin revision with no points array is a clear. IndexedDB drops a
  // key whose value was undefined, so the missing key is that clear too.
  const pinsWon =
    pinsFromRemote || stampMs(readStamp(local)) > stampMs(readStamp(remote));
  if (pinsWon || "points" in pins) {
    const value = "points" in pins ? pins.points : [];
    row.points = Array.isArray(value) ? value : [];
  }
  if (pins.pointsUpdated) row.pointsUpdated = pins.pointsUpdated;
  else delete row.pointsUpdated;
  const regions = regionsForPins(row.points);
  if (row.map || pins.map || regions !== null) {
    row.map = {
      ...(row.map ?? {}),
      ...(pins.map ?? {}),
      ...(regions !== null ? { regions } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(note !== undefined ? { summary: note } : {}),
    };
  }
  if (note !== undefined) row.note = note;
  const updated =
    stampMs(remote.updated) > stampMs(local.updated)
      ? remote.updated
      : local.updated;
  if (updated) row.updated = updated;
  return row;
}

export function backupUploadSet<T extends BackupEntry>(
  local: readonly T[],
  remote: readonly T[],
  now: number,
  days = BACKUP_DAYS,
): T[] {
  const byId = new Map<string, T>();
  for (const entry of remote) byId.set(entry.id, entry);
  for (const entry of local) {
    const previous = byId.get(entry.id);
    byId.set(entry.id, previous ? preferBackupRow(entry, previous) : entry);
  }
  return entriesForBackup([...byId.values()], now, days);
}

// The confirmation names notes and pins. The optional title, pin comments,
// answers, readings, and the AI note stay on the device.
export function toBackupPayload(
  entry: BackupEntry & Partial<SavedMap>,
): SavedMap {
  const points = (entry.points ?? []).map((point) => backupPin(point));
  return {
    id: entry.id,
    created: entry.created,
    ...(entry.updated ? { updated: entry.updated } : {}),
    ...(entry.noteUpdated ? { noteUpdated: entry.noteUpdated } : {}),
    ...(entry.pointsUpdated ? { pointsUpdated: entry.pointsUpdated } : {}),
    note: typeof entry.note === "string" ? entry.note : "",
    provider:
      typeof entry.provider === "string" ? entry.provider : "Your notes",
    answers: [],
    points,
    map: {
      title: "",
      summary: typeof entry.note === "string" ? entry.note : "",
      regions: regionsForUpload(points),
      quality: "",
      activity: "",
      duration: "",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  };
}

function regionsForUpload(points: readonly PainPoint[]): string[] {
  const regions: string[] = [];
  for (const point of points) {
    if (!regions.includes(point.region)) regions.push(point.region);
  }
  return regions;
}

function remoteMapTitle(entry: BackupEntry): string | undefined {
  const map = (entry as BackupEntry & { map?: { title?: unknown } }).map;
  return typeof map?.title === "string" ? map.title : undefined;
}

function regionsForPins(points: unknown): string[] | null {
  if (!Array.isArray(points)) return null;
  const regions: string[] = [];
  for (const point of points) {
    if (!point || typeof point !== "object") return null;
    const region = (point as { region?: unknown }).region;
    if (typeof region !== "string" || !region) return null;
    if (!regions.includes(region)) regions.push(region);
  }
  return regions;
}

function backupPin(point: PainPoint): PainPoint {
  return {
    id: point.id,
    region: point.region,
    structure: point.structure,
    position: point.position,
    ...(point.area ? { area: point.area } : {}),
    ...(point.source ? { source: point.source } : {}),
  };
}

function dropKeys<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const next = { ...value };
  for (const key of keys) delete next[key];
  return next;
}

function sameRegionSet(
  listed: readonly string[],
  pins: readonly string[],
): boolean {
  if (listed.length !== pins.length) return false;
  const have = new Set(listed);
  return have.size === listed.length && pins.every((id) => have.has(id));
}

// A downloaded region list is the surfaces on the pins. A list that names a
// surface with no pin is not stored.
export function withDownloadedRegions(entry: SavedMap): SavedMap | null {
  const regions = regionsForUpload(entry.points ?? []);
  if (!sameRegionSet(entry.map.regions, regions)) return null;
  return { ...entry, map: { ...entry.map, regions } };
}

function backedMap(entry: SavedMap): SavedMap["map"] {
  return {
    title: "",
    summary: entry.note,
    regions: regionsForUpload(entry.points ?? []),
    quality: "",
    activity: "",
    duration: "",
    intensity: null,
    question: null,
    urgent: false,
    safety_message: null,
  };
}

// The backup is the note and the pins. Title and the other map details stay
// on the device that recorded them.
export function withoutServerMapDetails(entry: SavedMap): SavedMap {
  const rest = dropKeys(entry, ["mapUpdated"]);
  return { ...rest, map: backedMap(entry) };
}

function withoutServerPrivateFields(entry: SavedMap): SavedMap {
  const points = entry.points?.map((point) => dropKeys(point, ["comment"]));
  const rest = dropKeys(withoutServerMapDetails(entry), [
    "ai",
    "aiUpdated",
    "research",
    "references",
  ]);
  return { ...rest, answers: [], ...(points ? { points } : {}) };
}

export function journalSignature(entry: SavedMap): string {
  const map = entry.map;
  return JSON.stringify([
    entry.id,
    entry.note,
    entry.noteUpdated ?? null,
    entry.pointsUpdated ?? null,
    entry.updated ?? null,
    map.title,
    map.summary,
    map.regions,
    map.quality,
    map.activity,
    map.duration,
    map.intensity,
    map.question,
    map.urgent,
    map.safety_message,
    (entry.points ?? []).map((point) => [
      point.id,
      point.region,
      point.structure,
      point.position,
      point.comment ?? null,
      point.area ?? null,
      point.source ?? null,
    ]),
    entry.answers.map((answer) => [answer.key, answer.text]),
    entry.ai
      ? [
          entry.ai.provider,
          entry.ai.created,
          entry.ai.based_on,
          entry.ai.map.summary,
        ]
      : null,
    entry.aiUpdated ?? null,
    entry.research
      ? [
          entry.research.activity,
          entry.research.description ?? null,
          entry.research.checked,
        ]
      : null,
    (entry.references ?? []).map((reference) => [
      reference.title,
      reference.url,
    ]),
  ]);
}

// The backup callback can be from before the user opened this entry.
// Compare the id that is open when the delete arrives.
export function remoteDeleteClosesEditor(
  openId: string,
  removedIds: readonly string[],
): boolean {
  return removedIds.includes(openId);
}

// The restore started on snapshotId. Close the editor only when that entry
// was in the download, was not stored, and is still the open entry.
export function restoreClosesEditor(
  openId: string,
  snapshotId: string,
  keptIds: ReadonlySet<string>,
  incomingIds: readonly string[],
): boolean {
  return (
    openId === snapshotId &&
    !keptIds.has(snapshotId) &&
    incomingIds.includes(snapshotId)
  );
}

// The open entry was deleted on another device. Keep a copy when this device
// has edits that are not in the saved row from when the pull started.
// The copy gets a new id so the deletion tombstone does not remove it.
export function entryKeptAfterRemoteDelete(
  open: SavedMap,
  prior: SavedMap | undefined,
  nextId: string,
): SavedMap | null {
  if (prior && journalSignature(prior) === journalSignature(open)) return null;
  if (!prior && open.note === "" && (open.points ?? []).length === 0)
    return null;
  return { ...open, id: nextId };
}

// Account deletion removes the backed entry. A remote delete can keep a newer
// local edit under a new id. Deletion must not.
export function entryKeptAfterRemove(
  open: SavedMap,
  prior: SavedMap | undefined,
  nextId: string,
  reason: "remote" | "account",
): SavedMap | null {
  if (reason === "account") return null;
  return entryKeptAfterRemoteDelete(open, prior, nextId);
}

// A later backup pull replaces the journal row. Skip the update when the
// visible fields are unchanged, so the save effect does not upload again.
export function savedAfterBackupPull(
  old: SavedMap[],
  fresh: readonly SavedMap[],
  stored: readonly SavedMap[],
): SavedMap[] {
  const kept = new Set(stored.map((row) => row.id));
  const map = new Map(old.map((item) => [item.id, item]));
  for (const row of fresh) {
    if (!kept.has(row.id)) map.delete(row.id);
  }
  for (const row of stored) map.set(row.id, row);
  const next = [...map.values()];
  const previous = new Map(
    old.map((item) => [item.id, journalSignature(item)]),
  );
  if (
    next.length === old.length &&
    next.every((row) => previous.get(row.id) === journalSignature(row))
  ) {
    return old;
  }
  return next;
}

// A pulled backup has no private fields. Put the device's copies back before
// the notebook merge so a restore does not clear them. A server copy of a
// comment, answer, search, or AI note is not stored.
export function withLocalPrivateFields(
  local: SavedMap | undefined,
  incoming: SavedMap,
): SavedMap {
  const cleaned = withoutServerPrivateFields(incoming);
  if (!local) return cleaned;
  const comments = new Map(
    (local.points ?? []).flatMap((point) =>
      point.comment ? [[point.id, point.comment] as const] : [],
    ),
  );
  const points = cleaned.points?.map((point) => {
    const comment = comments.get(point.id);
    return comment ? { ...point, comment } : point;
  });
  return {
    ...cleaned,
    ...(points ? { points } : {}),
    answers: local.answers,
    ...(local.ai ? { ai: local.ai } : {}),
    ...(local.aiUpdated ? { aiUpdated: local.aiUpdated } : {}),
    ...(local.research ? { research: local.research } : {}),
    ...(local.references ? { references: local.references } : {}),
    ...(local.mapUpdated ? { mapUpdated: local.mapUpdated } : {}),
    map: {
      ...cleaned.map,
      title: local.map.title,
      quality: local.map.quality,
      activity: local.map.activity,
      duration: local.map.duration,
      intensity: local.map.intensity,
      question: local.map.question,
      urgent: local.map.urgent,
      safety_message: local.map.safety_message,
    },
  };
}
