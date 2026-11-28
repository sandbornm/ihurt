import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { emailSignInAllowed, googleSignInAllowed } from "./config.ts";
import { useI18n } from "../i18n/react";
import { readBackupSnapshot, readDeletedIds } from "../notebook-storage.ts";
import type { SavedMap } from "../types.ts";
import {
  backupConfirmDecision,
  confirmAccountDecision,
  entriesForBackup,
  type BackupEntry,
} from "./backup.ts";
import { withoutOtherAccountEntries } from "./sync.ts";
import { AccountAuthError } from "./auth.ts";
import {
  closeUpgrade,
  deleteAccount,
  disableBackup,
  enableBackup,
  getAccountSnapshot,
  pushBackupEntries,
  signIn,
  signOut,
  startAccount,
  subscribeAccount,
} from "./store.ts";

type Step = "home" | "confirm-backup" | "confirm-delete";

function messageKey(code: string) {
  if (code === "email-sent") return "account.emailSent" as const;
  if (code === "unconfigured") return "account.notConfigured" as const;
  if (code === "no-api") return "account.noApi" as const;
  if (code === "recent-login") return "account.recentLogin" as const;
  if (code === "delete-partial") return "account.deletePartial" as const;
  if (code === "deleted") return "account.deleted" as const;
  if (code === "too-many") return "account.tooMany" as const;
  if (code === "too-large") return "account.tooLarge" as const;
  return "account.error" as const;
}

export default function AccountButton({
  entries,
  ready,
  onMerge,
  onRemove,
}: {
  entries: readonly BackupEntry[];
  ready: boolean;
  onMerge: (entries: SavedMap[]) => Promise<readonly SavedMap[] | void>;
  onRemove: (ids: string[], reason: "remote" | "account") => Promise<void>;
}) {
  useEffect(() => {
    startAccount();
  }, []);
  const snapshot = useSyncExternalStore(
    subscribeAccount,
    getAccountSnapshot,
    getAccountSnapshot,
  );
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [backupPreview, setBackupPreview] = useState<string[] | null>(null);
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [email, setEmail] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const upgrade = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    void readDeletedIds().then((deleted) => {
      if (!cancel)
        pushBackupEntries(entries, deleted, onMerge, (ids) =>
          onRemove(ids, "remote"),
        );
    });
    return () => {
      cancel = true;
    };
  }, [entries, ready, snapshot.optedIn, snapshot.session?.uid]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  useEffect(() => {
    const node = upgrade.current;
    if (!node) return;
    if (snapshot.upgrade && !node.open) node.showModal();
    if (!snapshot.upgrade && node.open) node.close();
  }, [snapshot.upgrade]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (error instanceof AccountAuthError && error.code === "cancelled")
        return;
    }
  }

  const provider = snapshot.session
    ? t(
        snapshot.session.provider === "apple"
          ? "account.provider.apple"
          : snapshot.session.provider === "google"
            ? "account.provider.google"
            : snapshot.session.provider === "email"
              ? "account.provider.email"
              : "account.provider.unknown",
      )
    : "";
  const backupEntries = entriesForBackup(
    snapshot.session
      ? withoutOtherAccountEntries(entries, localStorage, snapshot.session.uid)
      : entries,
    Date.now(),
  );
  const shownBackupIds =
    backupPreview ?? backupEntries.map((entry) => entry.id);
  const backupCount = shownBackupIds.length;
  const protocol =
    typeof location === "undefined" ? "https:" : location.protocol;
  const showEmail = emailSignInAllowed(protocol);
  const showGoogle = googleSignInAllowed(protocol);
  const title =
    step === "confirm-backup"
      ? t("account.confirmBackupTitle")
      : step === "confirm-delete"
        ? t("account.confirmDeleteTitle")
        : t("account.title");

  return (
    <>
      <button
        type="button"
        className="account-button"
        onClick={() => {
          setStep("home");
          setOpen(true);
        }}
      >
        {t("account.title")}
      </button>
      <dialog
        ref={dialog}
        className="dialog account-dialog"
        aria-labelledby="account-title"
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          setStep("home");
          setOpen(false);
        }}
      >
        <div className="dialog-heading">
          <h2 id="account-title">{title}</h2>
          <button
            type="button"
            aria-label={t("account.close")}
            onClick={() => {
              setStep("home");
              setOpen(false);
            }}
          >
            ×
          </button>
        </div>
        {step === "confirm-backup" && (
          <div className="account-actions">
            <p className="account-copy">
              {t("account.confirmBackup", { count: backupCount })}
            </p>
            <button
              type="button"
              className="primary"
              disabled={snapshot.busy}
              onClick={() =>
                void run(async () => {
                  const session = snapshot.session;
                  if (!session) return;
                  if (
                    confirmAccountDecision(confirmUid, session.uid) ===
                    "refresh"
                  ) {
                    setStep("home");
                    return;
                  }
                  const fresh = await readBackupSnapshot();
                  const deleted = new Set(fresh.deletedIds);
                  const snapshotIds = entriesForBackup(
                    withoutOtherAccountEntries(
                      fresh.entries.filter((entry) => !deleted.has(entry.id)),
                      localStorage,
                      session.uid,
                    ),
                    Date.now(),
                  ).map((entry) => entry.id);
                  if (
                    backupConfirmDecision(shownBackupIds, snapshotIds) ===
                    "refresh"
                  ) {
                    setBackupPreview(snapshotIds);
                    return;
                  }
                  const outcome = await enableBackup(
                    shownBackupIds,
                    async (remote) => {
                      const deleted = new Set(await readDeletedIds());
                      const kept = remote.filter(
                        (entry) => !deleted.has(entry.id),
                      );
                      return (await onMerge(kept)) ?? [];
                    },
                    (ids) => onRemove(ids, "remote"),
                  );
                  if (outcome?.status === "refresh") {
                    setBackupPreview([...outcome.ids]);
                    return;
                  }
                  setStep("home");
                })
              }
            >
              {t("account.confirmBackupAction")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setStep("home")}
            >
              {t("account.cancel")}
            </button>
          </div>
        )}
        {step === "confirm-delete" && (
          <div className="account-actions">
            <p className="account-copy">{t("account.confirmDelete")}</p>
            <button
              type="button"
              className="primary"
              disabled={snapshot.busy}
              onClick={() =>
                void run(async () => {
                  if (
                    confirmAccountDecision(
                      confirmUid,
                      snapshot.session?.uid ?? null,
                    ) === "refresh"
                  ) {
                    setStep("home");
                    return;
                  }
                  await deleteAccount((ids) => onRemove(ids, "account"));
                  setStep("home");
                  setOpen(false);
                })
              }
            >
              {t("account.confirmDeleteAction")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setStep("home")}
            >
              {t("account.cancel")}
            </button>
          </div>
        )}
        {step === "home" && (
          <div className="account-actions">
            <p className="account-copy">{t("account.optional")}</p>
            <p className="account-copy">{t("account.free")}</p>
            {snapshot.status === "unconfigured" && (
              <p className="account-copy">{t("account.notConfigured")}</p>
            )}
            {snapshot.busy && (
              <p role="status" className="account-copy">
                {t("account.working")}
              </p>
            )}
            {snapshot.notice && (
              <p role="status" className="account-copy">
                {t(messageKey(snapshot.notice))}
              </p>
            )}
            {snapshot.error && (
              <p role="alert" className="account-copy">
                {t(messageKey(snapshot.error))}
              </p>
            )}
            {!snapshot.session && (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={snapshot.busy || snapshot.status !== "ready"}
                  onClick={() => void run(() => signIn("apple"))}
                >
                  {t("account.apple")}
                </button>
                {showGoogle && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={snapshot.busy || snapshot.status !== "ready"}
                    onClick={() => void run(() => signIn("google"))}
                  >
                    {t("account.google")}
                  </button>
                )}
                {showEmail && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(() => signIn("email", email));
                    }}
                  >
                    <label>
                      {t("account.emailLabel")}
                      <input
                        type="email"
                        name="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="secondary"
                      disabled={snapshot.busy || snapshot.status !== "ready"}
                    >
                      {t("account.email")}
                    </button>
                  </form>
                )}
              </>
            )}
            {snapshot.session && (
              <>
                <p className="account-copy">
                  {t("account.signedIn")} · {provider}
                </p>
                {snapshot.remaining !== null && (
                  <p className="account-copy">
                    {t("account.searchesLeft", { count: snapshot.remaining })}
                  </p>
                )}
                <h3>{t("account.backup")}</h3>
                <p className="account-copy">
                  {snapshot.optedIn
                    ? t("account.backupOn")
                    : t("account.backupOff")}
                </p>
                {snapshot.optedIn ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void run(disableBackup)}
                  >
                    {t("account.turnOff")}
                  </button>
                ) : snapshot.canBackup ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={snapshot.busy}
                    onClick={() => {
                      setBackupPreview(null);
                      setConfirmUid(snapshot.session?.uid ?? null);
                      setStep("confirm-backup");
                    }}
                  >
                    {t("account.turnOn")}
                  </button>
                ) : (
                  <p className="account-copy">{t("account.noApi")}</p>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={snapshot.busy}
                  onClick={() => void run(signOut)}
                >
                  {t("account.signOut")}
                </button>
                {snapshot.canBackup ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={snapshot.busy}
                    onClick={() => {
                      setConfirmUid(snapshot.session?.uid ?? null);
                      setStep("confirm-delete");
                    }}
                  >
                    {t("account.delete")}
                  </button>
                ) : (
                  <p className="account-copy">
                    {t("account.deleteNeedsService")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </dialog>
      <dialog
        ref={upgrade}
        className="dialog account-dialog"
        aria-labelledby="upgrade-title"
        onClose={closeUpgrade}
        onCancel={(event) => {
          event.preventDefault();
          closeUpgrade();
        }}
      >
        <div className="dialog-heading">
          <h2 id="upgrade-title">{t("account.upgradeTitle")}</h2>
        </div>
        <p className="account-copy">{t("account.upgradeBody")}</p>
        <button type="button" className="primary" onClick={closeUpgrade}>
          {t("account.upgradeClose")}
        </button>
      </dialog>
    </>
  );
}
