import type { PainPoint, SavedMap } from "../types.ts";

export const BACKUP_DAYS = 90;
export const FREE_SEARCHES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupEntry {
  id: string;
  created: string;
  updated?: string;
}

export function withinBackupWindow(
  entry: Pick<BackupEntry, "created">,
  now: number,
  days = BACKUP_DAYS,
): boolean {
  const stamp = Date.parse(entry.created);
  if (!Number.isFinite(stamp)) return false;
  return stamp >= now - days * DAY_MS && stamp <= now + DAY_MS;
}

export function entriesForBackup<T extends BackupEntry>(
  entries: readonly T[],
  now: number,
  days = BACKUP_DAYS,
): T[] {
  return entries.filter((entry) => withinBackupWindow(entry, now, days));
}

// Local rows win when both sides have the same id. Remote-only rows stay,
// so the upload is not limited to the list this device had before the pull.
export function backupUploadSet<T extends BackupEntry>(
  local: readonly T[],
  remote: readonly T[],
  now: number,
  days = BACKUP_DAYS,
): T[] {
  const byId = new Map<string, T>();
  for (const entry of remote) byId.set(entry.id, entry);
  for (const entry of local) byId.set(entry.id, entry);
  return entriesForBackup([...byId.values()], now, days);
}

// The confirmation names notes and pins. Pin comments, answers, readings,
// and the AI note stay on the device.
export function toBackupPayload(entry: BackupEntry & Partial<SavedMap>): SavedMap {
  const points = (entry.points ?? []).map((point) => backupPin(point));
  return {
    id: entry.id,
    created: entry.created,
    ...(entry.updated ? { updated: entry.updated } : {}),
    ...(entry.noteUpdated ? { noteUpdated: entry.noteUpdated } : {}),
    ...(entry.pointsUpdated ? { pointsUpdated: entry.pointsUpdated } : {}),
    note: typeof entry.note === "string" ? entry.note : "",
    provider: typeof entry.provider === "string" ? entry.provider : "Your notes",
    answers: [],
    map: {
      title: entry.map?.title ?? "",
      summary: typeof entry.note === "string" ? entry.note : "",
      regions: entry.map?.regions ?? [],
      quality: "",
      activity: "",
      duration: "",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
    ...(points.length ? { points } : {}),
  };
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

// A pulled backup has no private fields. Put the device's copies back before
// the notebook merge so a restore does not clear them.
export function withLocalPrivateFields(
  local: SavedMap | undefined,
  incoming: SavedMap,
): SavedMap {
  if (!local) return incoming;
  const comments = new Map(
    (local.points ?? []).flatMap((point) =>
      point.comment ? [[point.id, point.comment] as const] : [],
    ),
  );
  const points = incoming.points?.map((point) => {
    const comment = comments.get(point.id);
    return comment ? { ...point, comment } : point;
  });
  return {
    ...incoming,
    ...(points ? { points } : {}),
    answers: incoming.answers.length > 0 ? incoming.answers : local.answers,
    ...(local.ai && !incoming.ai
      ? {
          ai: local.ai,
          ...(local.aiUpdated ? { aiUpdated: local.aiUpdated } : {}),
        }
      : {}),
    ...(local.research && !incoming.research ? { research: local.research } : {}),
    ...(local.references && !incoming.references
      ? { references: local.references }
      : {}),
    map: {
      ...incoming.map,
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
