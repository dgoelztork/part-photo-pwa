import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchFeedback,
  fetchFeedbackPhotoUrl,
  setFeedbackStatus,
  type FeedbackItem,
  type FeedbackStatus,
} from "../services/api-client";
import { TailscaleHint } from "../components/TailscaleHint";

/**
 * The list of everything filed against this app.
 *
 * Scupper shows its feedback on the dashboard; this app keeps its own list on
 * its own screen, because the two apps are deliberately separate. Same idea:
 * a place to see what's been reported and mark things done.
 */
export function FeedbackBoard() {
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [filter, setFilter] = useState<FeedbackStatus | "all">("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (status: FeedbackStatus | "all") => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchFeedback(status === "all" ? undefined : status));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load feedback");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const advance = async (item: FeedbackItem) => {
    const next: FeedbackStatus =
      item.status === "open" ? "in_progress" : item.status === "in_progress" ? "closed" : "open";
    try {
      const updated = await setFeedbackStatus(item.id, next);
      // Drop it from view when it no longer matches the active filter.
      setItems((prev) =>
        filter !== "all" && updated.status !== filter
          ? prev.filter((i) => i.id !== item.id)
          : prev.map((i) => (i.id === item.id ? updated : i))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    }
  };

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="text-primary text-sm font-medium px-2 py-1 -ml-2"
        >
          &larr; Back
        </button>
        <h2 className="text-lg font-semibold text-text">Feedback</h2>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {(["open", "in_progress", "closed", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
              filter === f
                ? "bg-primary text-white border-primary"
                : "bg-surface text-text-secondary border-border"
            }`}
          >
            {f === "in_progress" ? "Working" : f === "all" ? "All" : f === "open" ? "Open" : "Done"}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-text-secondary text-center py-6">Loading…</p>}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-error">Couldn't load feedback</p>
          <p className="text-xs text-text-secondary mt-1">{error}</p>
          <TailscaleHint />
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-text-secondary text-center py-8">
          Nothing here yet.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <FeedbackCard key={item.id} item={item} onAdvance={() => void advance(item)} />
        ))}
      </div>
    </div>
  );
}

function FeedbackCard({ item, onAdvance }: { item: FeedbackItem; onAdvance: () => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || !item.hasPhoto || photoUrl) return;
    let revoked: string | null = null;
    void fetchFeedbackPhotoUrl(item.id)
      .then((url) => {
        revoked = url;
        setPhotoUrl(url);
      })
      .catch((err) => console.warn("[Feedback] Photo load failed:", err));
    // Release the blob URL when the card unmounts, or memory leaks per photo.
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [expanded, item.hasPhoto, item.id, photoUrl]);

  const statusLabel =
    item.status === "in_progress" ? "Working" : item.status === "closed" ? "Done" : "Open";

  return (
    <div className="bg-surface rounded-xl p-3 shadow-sm">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-text break-words">
              <span className="text-text-secondary mr-1">
                {item.kind === "bug" ? "Bug" : "Idea"} #{item.id}
              </span>
              {item.title}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {item.userEmail ?? "unknown"} · {formatWhen(item.createdAt)}
              {item.hasPhoto ? " · photo" : ""}
            </p>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
              item.status === "closed"
                ? "bg-green-100 text-success"
                : item.status === "in_progress"
                  ? "bg-blue-50 text-primary"
                  : "bg-gray-100 text-text-secondary"
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
          {item.body && <p className="text-sm text-text whitespace-pre-wrap">{item.body}</p>}
          {item.page && <p className="text-xs text-text-secondary">Screen: {item.page}</p>}
          {photoUrl && (
            <img src={photoUrl} alt="Attached" className="rounded-lg border border-border" />
          )}
          <button
            onClick={onAdvance}
            className="mt-1 px-4 py-2 rounded-lg bg-surface border border-primary text-primary text-sm font-medium"
          >
            {item.status === "open"
              ? "Mark as working on it"
              : item.status === "in_progress"
                ? "Mark as done"
                : "Reopen"}
          </button>
        </div>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
