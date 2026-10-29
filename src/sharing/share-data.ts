import { regionName, type SavedMap } from "../types.ts";
import { t } from "../i18n/index.ts";

export const defaultSharing = {
  notes: true,
  comments: true,
  sources: true,
  ai: false,
};
export type SharingOptions = typeof defaultSharing;

export function prepareSharedEntry(
  entry: SavedMap,
  options: SharingOptions,
): SavedMap {
  const shared = structuredClone(entry);
  if (!options.notes) {
    shared.note = "";
    shared.map.summary = "";
    shared.map.title =
      shared.map.regions.map(regionName).join(" · ") || t("data.journalEntry");
  }
  if (!options.comments)
    shared.points?.forEach((point) => delete point.comment);
  if (!options.sources) shared.references = [];
  if (!options.sources || !options.notes || !options.comments)
    delete shared.research;
  if (!options.ai || !options.notes || !options.comments || !options.sources)
    delete shared.ai;
  return shared;
}

export function sharedSummary(entry: SavedMap): string {
  const context = entry.map;
  const pins = (entry.points ?? []).map(
    (point, index) =>
      `${index + 1}. ${regionName(point.region)} — ${point.structure}${point.comment ? `\n   ${point.comment}` : ""}`,
  );
  return [
    t("share.text.heading"),
    t("share.text.notAdvice"),
    t("share.text.data"),
    "",
    t("share.text.entry", { title: context.title || t("data.journalEntry") }),
    t("share.text.recorded", { date: entry.created }),
    t("share.text.updated", { date: entry.updated ?? entry.created }),
    t("share.text.regions", {
      regions:
        context.regions.map(regionName).join(", ") ||
        t("export.html.notRecorded"),
    }),
    context.activity && t("share.text.activity", { value: context.activity }),
    context.quality && t("share.text.feeling", { value: context.quality }),
    context.duration && t("share.text.timing", { value: context.duration }),
    context.intensity !== null &&
      t("share.text.intensity", { value: context.intensity }),
    entry.note && `\n${t("share.text.notes")}\n${entry.note}`,
    pins.length > 0 && `\n${t("share.text.spots")}\n${pins.join("\n")}`,
    entry.references?.length &&
      `\n${t("share.text.sources")}\n${entry.references.map((reference) => `${reference.publisher}: ${reference.title}\n${reference.url}\n${t("share.text.checked", { date: reference.checked })}${reference.context_url ? `\n${t("share.text.publisher", { url: reference.context_url })}` : ""}`).join("\n\n")}`,
    entry.ai &&
      `\n${t("share.text.ai", { provider: entry.ai.provider, date: entry.ai.created })}\n${entry.ai.map.summary}`,
    `\n${t("share.text.json")}`,
  ]
    .filter((line) => line !== false && line !== undefined && line !== 0)
    .join("\n");
}
