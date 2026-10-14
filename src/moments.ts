export function localDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayTitle(key: string, now = new Date()): string {
  if (key === localDayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDayKey(yesterday)) return "Yesterday";
  const [year, month, date] = key.split("-").map(Number);
  if (!year || !month || !date) return key;
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function dayKeys(
  isos: readonly string[],
  extra: readonly string[] = [],
  now = new Date(),
): string[] {
  const keys = new Set<string>();
  const today = localDayKey(now);
  if (today) keys.add(today);
  for (const key of extra) if (key) keys.add(key);
  for (const iso of isos) {
    const key = localDayKey(new Date(iso));
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

export function momentsOnDay<T extends { id: string; created: string }>(
  saved: readonly T[],
  draft: T | null,
  day: string,
): T[] {
  const list = saved.filter(
    (item) => localDayKey(new Date(item.created)) === day,
  );
  if (
    draft &&
    localDayKey(new Date(draft.created)) === day &&
    !list.some((item) => item.id === draft.id)
  )
    list.push(draft);
  return list.sort((a, b) => a.created.localeCompare(b.created));
}

export function momentLabel(entry: {
  map: { title: string; activity: string };
}): string {
  const title = entry.map.title.trim();
  if (title) return title;
  const activity = entry.map.activity.trim();
  if (activity) return activity;
  return "Untitled moment";
}

export function momentClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function historyMatch(
  entry: {
    note: string;
    map: { title: string; activity: string; quality: string };
    points?: { comment?: string; structure: string }[];
  },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const parts = [
    entry.note,
    entry.map.title,
    entry.map.activity,
    entry.map.quality,
    ...(entry.points ?? []).flatMap((point) => [
      point.comment ?? "",
      point.structure,
    ]),
  ];
  return parts.join("\n").toLowerCase().includes(needle);
}
