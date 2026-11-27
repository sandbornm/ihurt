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

// A successful pull is the cloud window. An id this device last uploaded, that
// is still inside the window and missing from that pull, was deleted on
// another device. A new local row was never uploaded, so it is not in `synced`.
// A row older than the window is absent because it aged out, and stays local.
export function idsDeletedOnServer<T extends BackupEntry>(
  synced: readonly string[],
  local: readonly T[],
  remote: readonly { id: string }[],
  deleted: ReadonlySet<string>,
  now: number,
  days = BACKUP_DAYS,
): string[] {
  const remoteIds = new Set(remote.map((entry) => entry.id));
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  return synced.filter((id) => {
    if (deleted.has(id) || remoteIds.has(id)) return false;
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
  // A newer pin revision with no points array is a clear. Leaving the key
  // off used to keep the other device's pins under an empty region list.
  if (pinsFromRemote || "points" in pins) {
    row.points = "points" in pins ? pins.points : [];
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
      regions: regionsForUpload(entry.map?.regions ?? [], points),
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

function regionsForUpload(
  listed: readonly string[],
  points: readonly PainPoint[],
): string[] {
  const regions = [...listed];
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

function withoutServerPrivateFields(entry: SavedMap): SavedMap {
  const points = entry.points?.map((point) => dropKeys(point, ["comment"]));
  const rest = dropKeys(entry, ["ai", "aiUpdated", "research", "references"]);
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
    map: {
      ...incoming.map,
      title: local.map.title || incoming.map.title,
      quality: incoming.map.quality || local.map.quality,
      activity: incoming.map.activity || local.map.activity,
      duration: incoming.map.duration || local.map.duration,
      intensity: incoming.map.intensity ?? local.map.intensity,
      question: incoming.map.question ?? local.map.question,
      urgent: incoming.map.urgent || local.map.urgent,
      safety_message: incoming.map.safety_message ?? local.map.safety_message,
    },
  };
}
