import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { regionName, type RegionId } from "./types";
import { findReadings, sources, recommendedSources } from "./reading";
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
              ? `Explore ${regionName(region).toLowerCase()}`
              : "Explore the reading library"}
          </h3>
          <p>Curated clinical, PT, OT, and sports science references.</p>
        </div>
      </div>
      <details className="source-picker">
        <summary>
          <SlidersHorizontal size={13} />
          Sources · {selectedSources.length} selected
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
                  {source.recommended ? " · Recommended" : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
        <button onClick={() => onSources(recommendedSources)}>
          Use recommended list
        </button>
        <p>
          Only checked sources appear. Recommended means an editorial starting
          list, not clinical endorsement.
        </p>
      </details>
      <label className="resource-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setExpanded(false);
          }}
          placeholder="Look up a topic, like neck or stretching"
          aria-label="Search educational resources"
        />
      </label>
      {matches.length ? (
        <>
          <div className="resource-links">
            {(expanded ? matches : matches.slice(0, 6)).map((resource) => (
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
                  <small>Link checked {resource.checked}</small>
                </span>
                <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
          {matches.length > 6 && (
            <button
              className="text-button"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? "Show fewer references"
                : `See all ${matches.length} references`}
            </button>
          )}
        </>
      ) : (
        <p className="resource-empty">
          {!selectedSources.length
            ? "Choose at least one source above."
            : query
              ? "No match in the curated library. Try another topic or source."
              : "Select a body region to see related reading."}
        </p>
      )}
      <p className="resource-notice">
        Matched by region and activity; these references do not establish a
        cause. The app has not assessed whether a stretch or treatment is
        appropriate for you. Read the source’s precautions and consult a
        qualified clinician.
      </p>
    </section>
  );
}
