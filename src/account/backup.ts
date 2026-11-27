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
