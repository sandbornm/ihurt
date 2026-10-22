import { useMemo, useState } from "react";
import { ArrowDownToLine, Copy } from "lucide-react";
import type { SavedMap } from "../types";
import { download, stringifyIhm } from "../export";
import { isNativeApp } from "../platform/files";
import { aiPrompt } from "../notebook-data";
import { useI18n } from "../i18n/react";
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
  const { t } = useI18n();
  return (
    <details
      className="share-with-ai"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("share.title")}</summary>
      {open && <ShareContents key={entry.id} entry={entry} valid={valid} />}
    </details>
  );
}

function ShareContents({ entry, valid }: { entry: SavedMap; valid: boolean }) {
  const [options, setOptions] = useState(defaultSharing);
  const { t, lang } = useI18n();
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const shared = useMemo(
    () => prepareSharedEntry(entry, options),
    [entry, options, lang],
  );
  const summary = useMemo(() => sharedSummary(shared), [shared]);
  const json = useMemo(
    () => (preview ? stringifyIhm(shared) : ""),
    [shared, preview, lang],
  );
  const canShareAI = options.notes && options.comments && options.sources;
  async function copy(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(success);
    } catch {
      setStatus(t("share.noClipboard"));
    }
  }
  async function save(format: "json" | "ihm") {
    try {
      setStatus(await download(shared, format));
    } catch {
      setStatus(
        t("share.saveFailed"),
      );
    }
  }
  return (
    <>
      <p>{t("share.intro")}</p>
      <fieldset className="share-options">
        <legend>{t("share.include")}</legend>
        {(
          [
            ["notes", t("share.opt.notes")],
            ["comments", t("share.opt.comments")],
            ["sources", t("share.opt.sources")],
            ["ai", t("share.opt.ai")],
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
      <p className="subtle">{t("share.included")}</p>
      <textarea
        aria-label={t("share.summaryLabel")}
        readOnly
        rows={7}
        value={summary}
      />
      <div className="export-pair">
        <button
          className="secondary"
          disabled={!valid}
          onClick={() =>
            void copy(summary, t("share.summaryCopied"))
          }
        >
          <Copy size={15} />
          {t("share.copySummary")}
        </button>
        <button
          className="secondary"
          disabled={!valid}
          onClick={() => void save("json")}
        >
          <ArrowDownToLine size={15} />
          {isNativeApp() ? t("share.saveJson") : t("share.downloadJson")}
        </button>
      </div>
      <details onToggle={(event) => setPreview(event.currentTarget.open)}>
        <summary>{t("share.previewJson")}</summary>
        {preview && (
          <textarea
            aria-label={t("share.previewLabel")}
            readOnly
            rows={8}
            value={json}
          />
        )}
      </details>
      <details>
        <summary>{t("share.promptTitle")}</summary>
        <textarea
          aria-label={t("share.promptLabel")}
          readOnly
          rows={4}
          value={aiPrompt()}
        />
        <div className="export-pair">
          <button
            className="secondary"
            onClick={() =>
              void copy(
                aiPrompt(),
                t("share.promptCopied"),
              )
            }
          >
            <Copy size={15} />
            {t("share.copyPrompt")}
          </button>
          <button
            className="secondary"
            disabled={!valid}
            onClick={() => void save("ihm")}
          >
            <ArrowDownToLine size={15} />
            {isNativeApp() ? t("share.saveIhm") : t("share.downloadIhm")}
          </button>
        </div>
      </details>
      {status && <p role="status">{status}</p>}
      <p className="subtle">{t("share.nothingSent")}</p>
    </>
  );
}
