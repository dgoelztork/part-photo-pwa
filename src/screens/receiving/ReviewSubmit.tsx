import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../../stores/session-store";
import { CONDITION_LABELS } from "../../types/session";
import { postGRPO } from "../../services/api-client";

export function ReviewSubmit() {
  const session = useSessionStore((s) => s.getActiveSession());
  const goToStep = useSessionStore((s) => s.goToStep);
  const setStatus = useSessionStore((s) => s.setStatus);
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [grpoDocNum, setGrpoDocNum] = useState<number | null>(null);

  if (!session) return null;

  const confirmedLines = session.lineItems.filter((l) => l.confirmed);
  const totalReceived = confirmedLines.reduce((sum, l) => sum + l.receivedQty, 0);
  const exceptions = confirmedLines.filter((l) => l.condition !== "good");
  const totalPhotos =
    session.boxPhotos.length +
    session.labelPhotos.length +
    session.packingSlipPhotos.length +
    session.documents.length +
    session.lineItems.reduce((sum, l) => sum + l.photos.length, 0);

  const poDocEntry = session.poDocEntry;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (poDocEntry) {
        // Post GRPO to SAP via proxy
        const grpoLines = confirmedLines
          .filter((l) => l.receivedQty > 0)
          .map((l) => ({
            baseEntry: poDocEntry,
            baseLine: l.lineNum,
            itemCode: l.itemCode,
            quantity: l.receivedQty,
            warehouse: "01", // Default warehouse
          }));

        const result = await postGRPO({
          vendorCode: session.vendorCode ?? "",
          poDocEntry,
          lines: grpoLines,
        });

        setGrpoDocNum(result.docNum);
      }

      setStatus("SUBMITTED");
      if (!poDocEntry) {
        // No SAP posting — just mark done
        navigate("/");
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Submission failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <div className="flex items-center gap-3">
        <button
          onClick={() => goToStep("STEP_5")}
          className="text-primary text-sm font-medium px-2 py-1 -ml-2"
        >
          &larr; Back
        </button>
        <h2 className="text-lg font-semibold text-text">Review & Submit</h2>
      </div>

      {/* Exceptions */}
      {exceptions.length > 0 && (
        <div className="bg-red-50 rounded-xl p-4 border border-red-200">
          <p className="text-sm font-semibold text-error mb-2">
            {exceptions.length} exception{exceptions.length > 1 ? "s" : ""} flagged
          </p>
          {exceptions.map((l) => (
            <p key={l.lineNum} className="text-xs text-error">
              {l.itemCode}: {CONDITION_LABELS[l.condition]}
              {l.notes ? ` — ${l.notes}` : ""}
            </p>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="flex flex-col gap-2">
        <SummaryRow
          label="Box Photos"
          value={`${session.boxPhotos.length} photo${session.boxPhotos.length !== 1 ? "s" : ""}`}
          extra={session.boxDamaged ? "Damage noted" : undefined}
          extraColor="text-error"
        />
        <SummaryRow
          label="Shipping Label"
          value={`${session.labelPhotos.length} photo${session.labelPhotos.length !== 1 ? "s" : ""}`}
          extra={session.shippingInfo.carrier || undefined}
        />
        <SummaryRow
          label="Packing Slip"
          value={`PO: ${session.poNumber || "N/A"}`}
          extra={`${session.packingSlipPhotos.length} page${session.packingSlipPhotos.length !== 1 ? "s" : ""}`}
        />
        <SummaryRow
          label="Documents"
          value={
            session.noDocuments
              ? "None included"
              : `${session.documents.length} document${session.documents.length !== 1 ? "s" : ""}`
          }
        />
        <SummaryRow
          label="Lines Received"
          value={`${confirmedLines.length} of ${session.lineItems.length} lines`}
          extra={`${totalReceived} items total`}
        />
      </div>

      {/* Line detail table */}
      <div className="bg-surface rounded-xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-[1fr_60px_60px] gap-1 p-3 text-xs font-medium text-text-secondary border-b border-border">
          <span>Item</span>
          <span className="text-center">Exp</span>
          <span className="text-center">Recv</span>
        </div>
        {session.lineItems.map((l) => (
          <div
            key={l.lineNum}
            className={`grid grid-cols-[1fr_60px_60px] gap-1 p-3 text-sm border-b border-border/50
                        ${l.condition !== "good" ? "bg-red-50" : ""}`}
          >
            <div>
              <p className="font-medium text-text">{l.itemCode}</p>
              <p className="text-xs text-text-secondary truncate">{l.itemDescription}</p>
            </div>
            <span className="text-center text-text-secondary">{l.openQty}</span>
            <span className={`text-center font-semibold ${l.confirmed ? "text-success" : "text-text-secondary"}`}>
              {l.confirmed ? l.receivedQty : "—"}
            </span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <p className="text-xs text-text-secondary text-center">
        {totalPhotos} total photos captured
      </p>

      {/* GRPO success */}
      {grpoDocNum && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-center animate-slide-in">
          <p className="text-lg font-bold text-success">GRPO Posted</p>
          <p className="text-sm text-text-secondary">Document #{grpoDocNum}</p>
          <button
            onClick={() => navigate("/")}
            className="mt-3 px-6 py-2 rounded-lg bg-primary text-white font-medium"
          >
            Done
          </button>
        </div>
      )}

      {/* Submit error */}
      {submitError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-slide-in">
          <p className="text-sm font-semibold text-error">Submission failed</p>
          <p className="text-xs text-text-secondary mt-1">{submitError}</p>
        </div>
      )}

      {/* Submit */}
      {!grpoDocNum && (
        <div className="mt-auto pt-4 flex flex-col gap-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || confirmedLines.length === 0}
            className="w-full py-4 rounded-xl bg-primary text-white font-semibold text-lg
                       disabled:opacity-40 active:scale-[0.98] transition-transform"
          >
            {submitting ? "Posting to SAP..." : "Submit Receiving"}
          </button>
          {!poDocEntry && (
            <p className="text-xs text-text-secondary text-center">
              No SAP PO linked — session will be saved locally only
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  extra,
  extraColor = "text-text-secondary",
}: {
  label: string;
  value: string;
  extra?: string;
  extraColor?: string;
}) {
  return (
    <div className="bg-surface rounded-xl p-3 shadow-sm flex justify-between items-center">
      <span className="text-sm text-text-secondary">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium text-text">{value}</span>
        {extra && <p className={`text-xs ${extraColor}`}>{extra}</p>}
      </div>
    </div>
  );
}
