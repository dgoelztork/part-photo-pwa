import { useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import type { ReceivingLine, ItemCondition } from "../../types/session";
import { CONDITION_LABELS } from "../../types/session";

export function LineReceivingStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const goToStep = useSessionStore((s) => s.goToStep);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  if (!session) return null;

  const confirmedCount = session.lineItems.filter((l) => l.confirmed).length;
  const totalLines = session.lineItems.length;

  if (selectedLine !== null) {
    const line = session.lineItems.find((l) => l.lineNum === selectedLine);
    if (line) {
      return (
        <LineDetailView
          line={line}
          onBack={() => setSelectedLine(null)}
        />
      );
    }
  }

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_5" onBack={() => goToStep("STEP_4")} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          PO: <span className="font-semibold text-text">{session.poNumber || "N/A"}</span>
        </p>
        <p className="text-sm text-text-secondary">
          {confirmedCount} of {totalLines} lines received
        </p>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-success rounded-full transition-all"
          style={{ width: `${totalLines > 0 ? (confirmedCount / totalLines) * 100 : 0}%` }}
        />
      </div>

      {/* Line list */}
      <div className="flex flex-col gap-2">
        {session.lineItems.map((line) => (
          <button
            key={line.lineNum}
            onClick={() => setSelectedLine(line.lineNum)}
            className={`bg-surface rounded-xl p-4 shadow-sm text-left
                        active:bg-bg transition-colors
                        ${line.confirmed ? "border-l-4 border-success" : ""}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-text">{line.itemCode}</p>
                <p className="text-sm text-text-secondary">{line.itemDescription}</p>
              </div>
              {line.confirmed ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-success">
                  Done
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-text-secondary">
                  Open
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-text-secondary">
              <span>Open: {line.openQty}</span>
              {line.previouslyReceivedQty > 0 && (
                <span>Prev: {line.previouslyReceivedQty}</span>
              )}
              <span>Photos: {line.photos.length}</span>
            </div>
          </button>
        ))}
      </div>

      <StepNavigation
        onNext={() => goToStep("REVIEW")}
        nextLabel="Review & Submit"
        nextDisabled={confirmedCount === 0}
      >
        {confirmedCount === 0 && (
          <p className="text-center text-sm text-text-secondary">
            Confirm at least 1 line to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}

function LineDetailView({
  line,
  onBack,
}: {
  line: ReceivingLine;
  onBack: () => void;
}) {
  const updateLine = useSessionStore((s) => s.updateLine);
  const addLinePhoto = useSessionStore((s) => s.addLinePhoto);
  const removeLinePhoto = useSessionStore((s) => s.removeLinePhoto);
  const confirmLine = useSessionStore((s) => s.confirmLine);

  const handleConfirm = () => {
    confirmLine(line.lineNum);
    onBack();
  };

  const conditions: ItemCondition[] = ["good", "damaged", "wrong_item", "short"];

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-primary text-sm font-medium px-2 py-1 -ml-2">
          &larr; Back
        </button>
        <h2 className="text-lg font-semibold text-text">Line {line.lineNum + 1}</h2>
      </div>

      {/* Part info */}
      <div className="bg-surface rounded-xl p-4 shadow-sm">
        <p className="text-lg font-bold text-text">{line.itemCode}</p>
        <p className="text-sm text-text-secondary">{line.itemDescription}</p>
        <div className="mt-2 flex gap-4 text-sm text-text-secondary">
          <span>Ordered: {line.orderedQty}</span>
          <span>Open: {line.openQty}</span>
        </div>
      </div>

      {/* Photo capture */}
      <CameraCapture
        onCapture={(photo) => addLinePhoto(line.lineNum, photo)}
        label="Photograph Item"
      />
      <PhotoGallery
        photos={line.photos}
        onDelete={(id) => removeLinePhoto(line.lineNum, id)}
      />

      {/* Quantity */}
      <div className="bg-surface rounded-xl p-4 shadow-sm">
        <label className="block text-sm font-medium text-text-secondary mb-2">
          Received Quantity
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={line.receivedQty}
          onChange={(e) =>
            updateLine(line.lineNum, {
              receivedQty: Math.min(Number(e.target.value) || 0, line.openQty),
            })
          }
          className="w-full p-3 rounded-lg border border-border text-2xl font-bold text-center"
        />
        <p className="text-xs text-text-secondary text-center mt-1">
          Max: {line.openQty}
        </p>
      </div>

      {/* Condition */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">Condition</label>
        <div className="grid grid-cols-2 gap-2">
          {conditions.map((c) => (
            <button
              key={c}
              onClick={() => updateLine(line.lineNum, { condition: c })}
              className={`py-3 rounded-xl text-sm font-medium transition-colors
                ${
                  line.condition === c
                    ? c === "good"
                      ? "bg-green-100 text-success border-2 border-success"
                      : c === "damaged"
                        ? "bg-red-100 text-error border-2 border-error"
                        : "bg-yellow-100 text-yellow-700 border-2 border-warning"
                    : "bg-surface border border-border text-text-secondary"
                }`}
            >
              {CONDITION_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <textarea
        value={line.notes}
        onChange={(e) => updateLine(line.lineNum, { notes: e.target.value })}
        placeholder="Notes (optional)"
        className="w-full p-3 rounded-lg border border-border text-base resize-none"
        rows={2}
      />

      {/* Confirm */}
      <div className="mt-auto pt-4">
        <button
          onClick={handleConfirm}
          disabled={line.photos.length === 0}
          className="w-full py-4 rounded-xl bg-success text-white font-semibold text-lg
                     disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {line.confirmed ? "Update Line" : "Confirm Line"}
        </button>
        {line.photos.length === 0 && (
          <p className="text-center text-sm text-text-secondary mt-2">
            Take at least 1 photo to confirm
          </p>
        )}
      </div>
    </div>
  );
}
