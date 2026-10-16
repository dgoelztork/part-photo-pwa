import { useEffect, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { useSessionStore } from "../stores/session-store";
import { getProxyUrl, setProxyUrl, checkProxyHealth, fetchPrinters, fetchPhotoAudit, DEFAULT_PROXY_URL, type PhotoAuditResult } from "../services/api-client";
import { TailscaleHint } from "../components/TailscaleHint";
import type { ReceivingSession } from "../types/session";
import { STEP_LABELS } from "../types/session";
import { needsPhotoResend, sendSessionPhotos } from "../lib/photo-resend";
import type { UploadProgress } from "../lib/file-exporter";

/**
 * True while the automatic resend is working through its list. Module-level,
 * not component state: the receiver can leave the dashboard and come back
 * mid-run, and a second pass over the same receipts would upload them twice.
 */
let resendRunning = false;

/**
 * GRPO numbers whose missing photos have been seen and acknowledged.
 *
 * Dismissal is per receipt, not a blanket "hide this banner". The whole point
 * of the banner is that this failure went unnoticed for two months — a switch
 * that silences it permanently would rebuild exactly that hole. Acknowledging
 * today's list still lets tomorrow's failure raise it again.
 *
 * Stored per device, so one receiver clearing it doesn't hide it from another.
 * Reads are defensive: a private window or blocked storage must not break the
 * dashboard.
 */
const ACK_KEY = "receiving.missingPhotos.acknowledged";

function readAcknowledged(): number[] {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function writeAcknowledged(docNums: number[]): void {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(docNums));
  } catch {
    // Best-effort — the banner reappearing is a far smaller problem than a
    // dashboard that throws on open.
  }
}

export function Dashboard() {
  const { userName, signOut } = useAuthStore();
  const { sessions, createSession, resumeSession, deleteSession, setPhotosUploadedFor } = useSessionStore();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [proxyUrlInput, setProxyUrlInput] = useState(getProxyUrl());
  const [proxyStatus, setProxyStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  // Label printing only appears once printers are configured on the proxy.
  // Until then the button would lead to a dead end for a receiver, so hide it.
  const [hasPrinters, setHasPrinters] = useState(false);
  // How many earlier receipts to list. Receivers come back to old ones to add
  // photos, so the list grows on request rather than stopping at a fixed count.
  const [olderShown, setOlderShown] = useState(10);

  // Receipts whose photos never landed. Silent by nature — the phone that
  // failed can't report it — so the dashboard asks SAP on every open.
  const [photoAudit, setPhotoAudit] = useState<PhotoAuditResult | null>(null);
  const [acknowledged, setAcknowledged] = useState<number[]>(readAcknowledged);

  useEffect(() => {
    void fetchPrinters()
      .then((printers) => setHasPrinters(printers.length > 0))
      .catch(() => setHasPrinters(false));
    void fetchPhotoAudit(7)
      .then((audit) => {
        setPhotoAudit(audit);
        // Drop acknowledgements for receipts that have aged out of the audit
        // window, so the stored list tracks the problem rather than growing
        // without bound.
        setAcknowledged((prev) => {
          const live = new Set(audit.missing.map((m) => m.docNum));
          const kept = prev.filter((n) => live.has(n));
          if (kept.length !== prev.length) writeAcknowledged(kept);
          return kept;
        });
      })
      .catch((err) => console.warn("[Dashboard] Photo audit unavailable:", err));
  }, []);

  // Photos that never finished sending, still on this phone. The "Upload the
  // photos" button on each receipt only helps if someone goes back to it, and
  // nobody does — so the dashboard sends them itself, one receipt at a time.
  const [resend, setResend] = useState<{
    label: string;
    index: number;
    total: number;
    progress: UploadProgress | null;
  } | null>(null);
  const [resendDone, setResendDone] = useState<{ sent: string[]; failed: string[] } | null>(null);

  useEffect(() => {
    const run = async () => {
      if (resendRunning) return;
      const pending = useSessionStore.getState().sessions.filter(needsPhotoResend);
      if (pending.length === 0) return;
      resendRunning = true;
      const sent: string[] = [];
      const failed: string[] = [];
      try {
        for (let i = 0; i < pending.length; i++) {
          const s = pending[i];
          const label = s.poNumber ? `PO ${s.poNumber}` : "a receipt";
          setResend({ label, index: i + 1, total: pending.length, progress: null });
          const result = await sendSessionPhotos(s, s.grpoDocEntry ?? null, (p) =>
            setResend((prev) => (prev ? { ...prev, progress: p } : prev)),
          );
          // null: that receipt is already uploading from its own screen.
          if (!result) continue;
          setPhotosUploadedFor(s.id, result.clean);
          (result.clean ? sent : failed).push(label);
        }
      } finally {
        resendRunning = false;
        setResend(null);
        setResendDone({ sent, failed });
      }
    };
    // Sessions come back from IndexedDB after the first render. Checking
    // before then would always find nothing to send.
    if (useSessionStore.persist.hasHydrated()) {
      void run();
      return;
    }
    return useSessionStore.persist.onFinishHydration(() => void run());
  }, [setPhotosUploadedFor]);

  const handleCheckProxy = async () => {
    setProxyUrl(proxyUrlInput);
    setProxyStatus("checking");
    const ok = await checkProxyHealth();
    setProxyStatus(ok ? "ok" : "error");
  };

  // Restore the canonical proxy URL and re-test. Common fix when a new user
  // typed the URL wrong on first setup and the bad value got stuck in
  // localStorage. Also clears the cached JWT so a fresh auth happens next call.
  const handleResetProxy = async () => {
    setProxyUrlInput(DEFAULT_PROXY_URL);
    setProxyUrl(DEFAULT_PROXY_URL);
    setProxyStatus("checking");
    const ok = await checkProxyHealth();
    setProxyStatus(ok ? "ok" : "error");
  };

  const handleNewSession = () => {
    const id = createSession(userName);
    navigate(`/receive/${id}`);
  };

  const handleResume = (session: ReceivingSession) => {
    resumeSession(session.id);
    navigate(`/receive/${session.id}`);
  };

  const handleDelete = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Delete this session?")) {
      deleteSession(id);
    }
  };

  const todaySessions = sessions.filter((s) => {
    const today = new Date().toISOString().slice(0, 10);
    return s.createdAt.slice(0, 10) === today;
  });

  const olderSessions = sessions.filter((s) => {
    const today = new Date().toISOString().slice(0, 10);
    return s.createdAt.slice(0, 10) !== today;
  });

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-text">Receiving</h1>
          <p className="text-sm text-text-secondary">{userName}</p>
        </div>
        <button
          onClick={signOut}
          className="text-sm text-text-secondary px-2 py-1"
        >
          Sign out
        </button>
      </div>

      {/* Resending photos from earlier receipts. Same warning as the submit
          screen: the phone stops the page when it locks or is switched away. */}
      {resend && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 animate-slide-in">
          <p className="text-sm font-semibold text-text">
            Sending photos that didn't finish earlier
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {resend.label}
            {resend.total > 1 ? ` (receipt ${resend.index} of ${resend.total})` : ""}
            {resend.progress ? ` · photo ${resend.progress.current} of ${resend.progress.total}` : ""}
          </p>
          {resend.progress && (
            <div className="h-2 rounded-full bg-green-100 overflow-hidden mt-2">
              <div
                className="h-full bg-success transition-all duration-300"
                style={{
                  width: `${Math.round((resend.progress.current / Math.max(1, resend.progress.total)) * 100)}%`,
                }}
              />
            </div>
          )}
          <p className="text-xs text-error mt-2 font-medium">
            Keep this screen open until it finishes.
          </p>
        </div>
      )}

      {!resend && resendDone && (resendDone.sent.length > 0 || resendDone.failed.length > 0) && (
        <div
          className={`p-4 rounded-xl border animate-slide-in ${
            resendDone.failed.length > 0 ? "bg-amber-50 border-amber-300" : "bg-green-50 border-green-200"
          }`}
        >
          {resendDone.sent.length > 0 && (
            <p className="text-sm text-text">
              Sent the photos for {resendDone.sent.join(", ")}.
            </p>
          )}
          {resendDone.failed.length > 0 && (
            <p className="text-sm text-text mt-1">
              Couldn't send the photos for {resendDone.failed.join(", ")}. They're still on
              this phone, and the app will try again next time it opens.
            </p>
          )}
          <button
            onClick={() => setResendDone(null)}
            className="mt-2 text-xs text-text-secondary underline"
          >
            OK
          </button>
        </div>
      )}

      {/* Photos that never made it. Deliberately loud and deliberately at the
          top: this failure hid for two months because nothing surfaced it. */}
      {(() => {
        if (!photoAudit) return null;
        const ackSet = new Set(acknowledged);
        const unseen = photoAudit.missing.filter((m) => !ackSet.has(m.docNum));
        if (unseen.length === 0) return null;
        return (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 animate-slide-in">
            <p className="text-sm font-semibold text-text">
              {unseen.length} recent receipt{unseen.length === 1 ? "" : "s"} missing photos
            </p>
            <p className="text-xs text-text-secondary mt-1">
              These posted to SAP, but their photos never reached SharePoint. If the
              pictures are still on the phone that took them, add them by hand.
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {unseen.slice(0, 6).map((m) => (
                <p key={m.docNum} className="text-xs text-text">
                  <span className="font-medium">GRPO {m.docNum}</span>
                  {/* The PO matters more than the receipt number here: photos
                      are filed under the PO, so it is what you search for to
                      add them by hand. */}
                  {m.poNumbers?.length ? ` · PO ${m.poNumbers.join("/")}` : ""}
                  {m.docDate ? ` · ${m.docDate}` : ""}
                  {m.receivedBy ? ` · ${m.receivedBy.split("@")[0]}` : ""}
                </p>
              ))}
              {unseen.length > 6 && (
                <p className="text-xs text-text-secondary">and {unseen.length - 6} more</p>
              )}
            </div>
            <button
              onClick={() => {
                // Acknowledge only what's on screen. A receipt that fails
                // tomorrow isn't covered by today's dismissal.
                const next = [...new Set([...acknowledged, ...unseen.map((m) => m.docNum)])];
                setAcknowledged(next);
                writeAcknowledged(next);
              }}
              className="mt-3 px-4 py-2 rounded-lg bg-surface border border-amber-400
                         text-text text-sm font-medium active:scale-[0.98] transition-transform"
            >
              Got it — don't show these again
            </button>
          </div>
        );
      })()}

      {/* New Session */}
      <button
        onClick={handleNewSession}
        className="w-full py-5 rounded-xl bg-primary text-white font-semibold text-lg
                   active:scale-[0.98] transition-transform"
      >
        Start New Receiving Session
      </button>

      {/* Label printing — a standalone job, not part of a receiving session,
          so it gets its own entry rather than a step in the wizard. */}
      {hasPrinters && (
      <button
        onClick={() => navigate("/labels")}
        className="w-full py-4 rounded-xl bg-surface border border-primary text-primary
                   font-semibold active:scale-[0.98] transition-transform"
      >
        Print Item Labels
      </button>
      )}

      <button
        onClick={() => navigate("/feedback")}
        className="w-full py-3 rounded-xl bg-surface border border-border text-text font-medium"
      >
        Feedback
      </button>

      {/* Settings toggle */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="text-sm text-text-secondary self-end -mt-2"
      >
        {showSettings ? "Hide Settings" : "Settings"}
      </button>

      {showSettings && (
        <div className="bg-surface rounded-xl p-4 shadow-sm animate-slide-in flex flex-col gap-3">
          <h3 className="text-sm font-medium text-text-secondary">Proxy Server</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={proxyUrlInput}
              onChange={(e) => {
                setProxyUrlInput(e.target.value);
                setProxyStatus("idle");
              }}
              placeholder={DEFAULT_PROXY_URL}
              className="flex-1 p-3 rounded-lg border border-border text-sm"
            />
            <button
              onClick={handleCheckProxy}
              disabled={proxyStatus === "checking"}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium
                         disabled:opacity-40 whitespace-nowrap"
            >
              {proxyStatus === "checking" ? "..." : "Test"}
            </button>
          </div>
          {proxyUrlInput !== DEFAULT_PROXY_URL && (
            <button
              onClick={handleResetProxy}
              disabled={proxyStatus === "checking"}
              className="text-xs text-primary self-start underline disabled:opacity-40"
            >
              Reset to default
            </button>
          )}
          {proxyStatus === "ok" && (
            <p className="text-sm text-success">Connected to proxy</p>
          )}
          {proxyStatus === "error" && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-error">Cannot reach proxy at {proxyUrlInput}</p>
              <TailscaleHint />
            </div>
          )}
        </div>
      )}

      {/* Today's sessions */}
      {todaySessions.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-2">Today</h2>
          <div className="flex flex-col gap-2">
            {todaySessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                onResume={() => handleResume(s)}
                onDelete={(e) => handleDelete(e, s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Older sessions */}
      {olderSessions.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-2">Previous</h2>
          <div className="flex flex-col gap-2">
            {olderSessions.slice(0, olderShown).map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                onResume={() => handleResume(s)}
                onDelete={(e) => handleDelete(e, s.id)}
              />
            ))}
            {olderSessions.length > olderShown && (
              <button
                onClick={() => setOlderShown((n) => n + 20)}
                className="py-3 text-sm font-medium text-primary"
              >
                Show more ({olderSessions.length - olderShown} older)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  onResume,
  onDelete,
}: {
  session: ReceivingSession;
  onResume: () => void;
  onDelete: (e: MouseEvent) => void;
}) {
  const time = new Date(session.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = new Date(session.createdAt).toLocaleDateString();
  const isSubmitted = session.status === "SUBMITTED";
  const stepLabel = STEP_LABELS[session.status] ?? session.status;

  return (
    <div
      onClick={onResume}
      className="bg-surface rounded-xl p-4 shadow-sm flex justify-between items-center cursor-pointer active:bg-bg"
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text">
            {session.poNumber || "No PO yet"}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              isSubmitted
                ? "bg-green-100 text-success"
                : "bg-blue-100 text-primary"
            }`}
          >
            {isSubmitted ? "Submitted" : stepLabel}
          </span>
        </div>
        <span className="text-xs text-text-secondary">
          {date} at {time}
        </span>
      </div>
      {!isSubmitted && (
        <button
          onClick={onDelete}
          className="text-text-secondary text-sm px-2 py-1"
        >
          &times;
        </button>
      )}
    </div>
  );
}
