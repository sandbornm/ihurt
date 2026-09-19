import { useMemo, useState } from "react";
import { ArrowDownToLine, Copy } from "lucide-react";
import type { SavedMap } from "../types";
import { download, stringifyIhm } from "../export";
import { isNativeApp } from "../platform/files";
import { aiPrompt } from "../notebook-data";
import {
  defaultSharing,
  prepareSharedEntry,
  sharedSummary,
} from "./share-data";

export default function ShareWithAI({
  entry,
  valid,
}: {
  entry: SavedMap;
  valid: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="share-with-ai"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Share with AI</summary>
      {open && <ShareContents key={entry.id} entry={entry} valid={valid} />}
    </details>
  );
}

function ShareContents({ entry, valid }: { entry: SavedMap; valid: boolean }) {
  const [options, setOptions] = useState(defaultSharing);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const shared = useMemo(
    () => prepareSharedEntry(entry, options),
    [entry, options],
  );
  const summary = useMemo(() => sharedSummary(shared), [shared]);
  const json = useMemo(
    () => (preview ? stringifyIhm(shared) : ""),
    [shared, preview],
  );
  const canShareAI = options.notes && options.comments && options.sources;
  async function copy(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(success);
    } catch {
      setStatus("Clipboard unavailable. Select and copy the text below.");
    }
  }
  async function save(format: "json" | "ihm") {
    try {
      setStatus(await download(shared, format));
    } catch {
      setStatus(
        "The file could not be saved. Check available storage and try again.",
      );
    }
  }
  return (
    <>
      <p>
        Share this entry with your favorite AI. Choose what to include, review
        it, then copy the summary or attach the JSON in your chat.
      </p>
      <fieldset className="share-options">
        <legend>Include in this copy</legend>
        {(
          [
            ["notes", "Entry notes and title"],
            ["comments", "Pin comments"],
            ["sources", "Saved sources"],
            ["ai", "Previous AI interpretation"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={key === "ai" ? options.ai && canShareAI : options[key]}
              disabled={key === "ai" && !canShareAI}
              onChange={(event) => {
                setOptions((old) => ({ ...old, [key]: event.target.checked }));
                setStatus("");
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="subtle">
        Dates, activity, feeling, timing, intensity, and pin locations are
        included. Previous AI text is available only when all fields are
        included, because it can repeat them. Your saved entry stays unchanged.
      </p>
      <textarea
        aria-label="AI sharing summary"
        readOnly
        rows={7}
        value={summary}
      />
      <div className="export-pair">
        <button
          className="secondary"
          disabled={!valid}
          onClick={() =>
            void copy(summary, "Summary copied. Paste it in your AI chat.")
          }
        >
          <Copy size={15} />
          Copy summary
        </button>
        <button
          className="secondary"
          disabled={!valid}
          onClick={() => void save("json")}
        >
          <ArrowDownToLine size={15} />
          {isNativeApp() ? "Save / share JSON" : "Download sharing JSON"}
        </button>
      </div>
      <details onToggle={(event) => setPreview(event.currentTarget.open)}>
        <summary>Preview shared JSON</summary>
        {preview && (
          <textarea
            aria-label="Shared JSON preview"
            readOnly
            rows={8}
            value={json}
          />
        )}
      </details>
      <details>
        <summary>Suggested prompt and .ihm file</summary>
        <textarea
          aria-label="Suggested AI prompt"
          readOnly
          rows={4}
          value={aiPrompt}
        />
        <div className="export-pair">
          <button
            className="secondary"
            onClick={() =>
              void copy(
                aiPrompt,
                "Prompt copied. Attach your JSON file in the AI chat.",
              )
            }
          >
            <Copy size={15} />
            Copy prompt
          </button>
          <button
            className="secondary"
            disabled={!valid}
            onClick={() => void save("ihm")}
          >
            <ArrowDownToLine size={15} />
            {isNativeApp() ? "Save / share .ihm" : "Download .ihm map"}
          </button>
        </div>
      </details>
      {status && <p role="status">{status}</p>}
      <p className="subtle">
        Nothing is sent automatically. The AI service you choose may retain what
        you share. JSON and .ihm contain the same map, anatomy references,
        heatmap, and review prompt.
      </p>
    </>
  );
}
