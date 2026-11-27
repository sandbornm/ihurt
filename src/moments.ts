export function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// "today" and "yesterday" are tokens. The screen translates them.
export function dayTitle(
  key: string,
  now = new Date(),
  locale?: string,
): "today" | "yesterday" | string {
  if (key === localDayKey(now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDayKey(yesterday)) return "yesterday";
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function dayKeys(
  created: string[],
  extra: string[] = [],
  now = new Date(),
) {
  const keys = new Set<string>([localDayKey(now), ...extra]);
  for (const iso of created) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) keys.add(localDayKey(date));
  }
  return [...keys].sort();
}

export function momentsOnDay<T extends { id: string; created: string }>(
  saved: T[],
  current: T,
  day: string,
) {
  const rows = saved.filter(
    (item) => localDayKey(new Date(item.created)) === day,
  );
  if (
    localDayKey(new Date(current.created)) === day &&
    !rows.some((item) => item.id === current.id)
  ) {
    rows.push(current);
  }
  return rows.sort((a, b) => a.created.localeCompare(b.created));
}

export function momentLabel(entry: {
  map: { title?: string; activity?: string };
}): string | null {
  const title = entry.map.title?.trim();
  if (title) return title;
  const activity = entry.map.activity?.trim();
  if (activity) return activity;
  return null;
}

export function momentClock(iso: string, locale?: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function historyMatch(
  entry: {
    note?: string;
    map: { title?: string; activity?: string; quality?: string };
    points?: { comment?: string; structure?: string }[];
  },
  query: string,
  labels: string[] = [],
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const parts = [
    entry.note ?? "",
    entry.map.title ?? "",
    entry.map.activity ?? "",
    entry.map.quality ?? "",
    ...(entry.points ?? []).flatMap((point) => [
      point.comment ?? "",
      point.structure ?? "",
    ]),
    ...labels,
  ];
  return parts.join("\n").toLowerCase().includes(needle);
}
