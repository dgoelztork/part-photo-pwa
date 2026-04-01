import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { useSessionStore } from "../stores/session-store";
import type { ReceivingSession } from "../types/session";
import { STEP_LABELS } from "../types/session";

export function Dashboard() {
  const { userName, signOut } = useAuthStore();
  const { sessions, createSession, resumeSession, deleteSession } = useSessionStore();
  const navigate = useNavigate();

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

      {/* New Session */}
      <button
        onClick={handleNewSession}
        className="w-full py-5 rounded-xl bg-primary text-white font-semibold text-lg
                   active:scale-[0.98] transition-transform"
      >
        Start New Receiving Session
      </button>

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
            {olderSessions.slice(0, 10).map((s) => (
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
      onClick={isSubmitted ? undefined : onResume}
      className={`bg-surface rounded-xl p-4 shadow-sm flex justify-between items-center
                  ${isSubmitted ? "opacity-60" : "cursor-pointer active:bg-bg"}`}
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
