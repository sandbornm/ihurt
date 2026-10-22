import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { regionName, type RegionId } from "./types";
import { findReadings, sources, recommendedSources } from "./reading";
import { useI18n } from "./i18n/react";
export default function Resources({
  region,
  activity,
  urgent,
  selectedSources,
  onSources,
}: {
  region: RegionId | null;
  activity: string;
  urgent: boolean;
  selectedSources: string[];
  onSources: (sources: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (urgent) return null;
  const matches = findReadings(
    region ? [region] : [],
    activity,
    selectedSources,
    query,
  );
  return (
    <section className="resource-panel">
      <div className="resource-heading">
        <BookOpen size={17} />
        <div>
          <h3>
            {region
              ? t("res.readingFor", { region: regionName(region).toLowerCase() })
              : t("export.html.readingTitle")}
          </h3>
          <p>{t("res.curated")}</p>
        </div>
      </div>
      <details className="source-picker">
        <summary>
          <SlidersHorizontal size={13} />
          {t("res.sources", { count: selectedSources.length })}
        </summary>
        <div>
          {sources.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={selectedSources.includes(source.id)}
                onChange={(e) =>
                  onSources(
                    e.target.checked
                      ? [...selectedSources, source.id]
                      : selectedSources.filter((id) => id !== source.id),
                  )
                }
              />
              <span>
                {source.name}
                <small>
                  {source.kind}
                  {source.recommended ? ` · ${t("res.recommended")}` : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
        <button onClick={() => onSources(recommendedSources)}>
          {t("res.useRecommended")}
        </button>
      </details>
      <label className="resource-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setExpanded(false);
          }}
          placeholder={t("res.search")}
          aria-label={t("res.searchLabel")}
        />
      </label>
      {matches.length ? (
        <>
          <div className="resource-links">
            {(expanded ? matches : matches.slice(0, 4)).map((resource) => (
              <a
                key={resource.id}
                href={resource.url}
                target="_blank"
                rel="noreferrer"
              >
                <span>
                  <small>
                    {sources.find((s) => s.id === resource.source)?.name} ·{" "}
                    {resource.type}
                  </small>
                  <strong>{resource.title}</strong>
                  <small>{t("res.checked", { date: resource.checked })}</small>
                </span>
                <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
          {matches.length > 4 && (
            <button
              className="text-button"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? t("res.fewer")
                : t("res.all", { count: matches.length })}
            </button>
          )}
        </>
      ) : (
        <p className="resource-empty">
          {!selectedSources.length
            ? t("res.chooseSource")
            : query
              ? t("res.noMatch")
              : t("res.selectRegion")}
        </p>
      )}
      <p className="resource-notice">
        {t("res.notice")}
      </p>
    </section>
  );
}
