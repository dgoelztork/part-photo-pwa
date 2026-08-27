import { useState } from "react";
import { useLocation } from "react-router-dom";
import { CameraCapture } from "./camera/CameraCapture";
import { submitFeedback, photoToDataUrl, type FeedbackKind } from "../services/api-client";
import type { CapturedPhoto } from "../types/session";
import { TailscaleHint } from "./TailscaleHint";

/**
 * Floating feedback button, mounted globally so a receiver can report a bug or
 * suggest an idea from wherever they are — mid-receipt included.
 *
 * Modelled on Scupper's FeedbackButton, but this app keeps its own list — the
 * two are deliberately separate systems. One difference worth noting: Scupper
 * auto-captures the screen with html2canvas. This is a phone in a warehouse,
 * where the useful picture is usually the part or the shelf rather than the
 * screen, and screen capture is unreliable inside an iOS web app. So it offers
 * the camera the app already uses instead.
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Small and translucent until touched: it sits over a working screen
          and must never compete with the step buttons. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Send feedback"
          className="fixed right-3 bottom-20 z-40 w-12 h-12 rounded-full bg-surface/90 border border-border
                     shadow-lg text-primary text-xl leading-none active:scale-95 transition-transform
                     safe-bottom"
        >
          ?
        </button>
      )}

      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  // Bug is the common case, same default as Scupper.
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const canSend = title.trim().length > 0 && status !== "sending";

  const handleSend = async () => {
    setStatus("sending");
    setError(null);
    try {
      // A photo that fails to encode shouldn't cost them the written report,
      // so the conversion is best-effort.
      let photoDataUrl: string | null = null;
      if (photo) {
        try {
          photoDataUrl = await photoToDataUrl(photo.blob);
        } catch (err) {
          console.warn("[Feedback] Could not encode photo, sending without it:", err);
        }
      }

      await submitFeedback({
        kind,
        title: title.trim(),
        body: body.trim() || undefined,
        page: location.pathname,
        photo: photoDataUrl,
      });
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send feedback");
    }
  };

  if (status === "sent") {
    return (
      <Sheet onClose={onClose}>
        <div className="text-center py-4">
          <p className="text-lg font-bold text-success">Thanks — sent</p>
          <p className="text-sm text-text-secondary mt-1">
            It's been added to the feedback list.
          </p>
          <button
            onClick={onClose}
            className="mt-4 px-6 py-2 rounded-lg bg-primary text-white font-medium"
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text">Send Feedback</h2>
        <button onClick={onClose} className="text-sm text-text-secondary px-2 py-1">
          Cancel
        </button>
      </div>

      {/* Kind */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(["bug", "idea"] as FeedbackKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`py-3 rounded-lg border font-medium capitalize transition-colors ${
              kind === k
                ? "bg-primary text-white border-primary"
                : "bg-surface text-text border-border"
            }`}
          >
            {k === "bug" ? "Something's wrong" : "Idea"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 mb-3">
        <span className="text-xs font-medium text-text-secondary">
          {kind === "bug" ? "What went wrong?" : "What would help?"}
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "bug" ? "Short summary" : "Short summary"}
          className="border border-border rounded-lg px-3 py-3 text-base"
        />
      </label>

      <label className="flex flex-col gap-1 mb-3">
        <span className="text-xs font-medium text-text-secondary">
          Any more detail? (optional)
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="What you were doing, what you expected"
          className="border border-border rounded-lg px-3 py-3 text-base resize-none"
        />
      </label>

      {/* Photo — the warehouse equivalent of Scupper's screenshot. */}
      <div className="mb-3">
        <span className="text-xs font-medium text-text-secondary">Photo (optional)</span>
        {photo ? (
          <div className="mt-1 flex items-center gap-3">
            <img
              src={photo.thumbnailUrl}
              alt="Attached"
              className="w-16 h-16 object-cover rounded-lg border border-border"
            />
            <button
              onClick={() => setPhoto(null)}
              className="text-sm text-error font-medium"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="mt-1">
            <CameraCapture onCapture={setPhoto} label="Add Photo" />
          </div>
        )}
      </div>

      <button
        onClick={() => void handleSend()}
        disabled={!canSend}
        className="w-full py-4 rounded-xl bg-primary text-white font-semibold text-lg
                   disabled:opacity-40 active:scale-[0.98] transition-transform"
      >
        {status === "sending" ? "Sending…" : "Send"}
      </button>

      {status === "error" && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs text-error">{error}</p>
          <TailscaleHint />
        </div>
      )}
    </Sheet>
  );
}

/** Bottom sheet — reachable one-handed, unlike a centred dialog. */
function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-lg bg-bg rounded-t-2xl p-4 pb-6 safe-bottom
                   max-h-[90vh] overflow-y-auto animate-slide-in"
      >
        {children}
      </div>
    </div>
  );
}
