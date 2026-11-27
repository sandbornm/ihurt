export const BACKUP_DAYS = 90;
export const FREE_SEARCHES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupEntry {
  id: string;
  created: string;
  updated?: string;
}

export function withinBackupWindow(
  entry: Pick<BackupEntry, "created" | "updated">,
  now: number,
  days = BACKUP_DAYS,
): boolean {
  const stamp = Date.parse(entry.updated || entry.created);
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
