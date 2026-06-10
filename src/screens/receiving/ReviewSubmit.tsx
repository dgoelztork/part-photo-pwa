import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../../stores/session-store";
import { CONDITION_LABELS, type ReceivingSession } from "../../types/session";
import { postGRPO, patchGrpoDocsUrl } from "../../services/api-client";
import {
  uploadReceivingSessionToSharePoint,
  type ReceivingUploadResult,
  type UploadProgress,
} from "../../lib/file-exporter";
import { TailscaleHint } from "../../components/TailscaleHint";

/**
 * Build the catch-all string written to OPDN.U_GRPOdetails. Anything the
 * receiver entered that doesn't have its own SAP destination today (carrier
 * choice, edited shipping details, box damage, line exceptions, etc.) lands
 * here. Format is plain-text section blocks, easy to read in SAP.
 */
function buildGrpoDetails(session: ReceivingSession): string {
  const sections: string[] = [];

  if (session.shipmentBoxCount > 1) {
    sections.push(`[SHIPMENT] ${session.shipmentBoxCount} boxes`);
  }

  if (session.boxDamaged) {
    const note = session.boxDamageNotes.trim();
    sections.push(`[BOX] Damaged${note ? ` — ${note}` : ""}`);
  }

  if (session.carrier) {
    sections.push(`[CARRIER] ${session.carrier}`);
  }

  const sd = session.shippingDetails;
  const sdParts = [
    sd.transpCode && `transp=${sd.transpCode}`,
    sd.shipSpeed && `speed=${sd.shipSpeed}`,
    sd.frtChargeType && `charge=${sd.frtChargeType}`,
    sd.fob && `fob=${sd.fob}`,
    sd.shipToZip && `shipToZip=${sd.shipToZip}`,
  ].filter(Boolean);
  if (sdParts.length > 0) {
    sections.push(`[SHIPPING] ${sdParts.join(" / ")}`);
  }

  // Per-box breakdown — tracking, weight, origin ZIP, freight rate per box.
  session.boxes.forEach((b, i) => {
    const parts = [
      b.trackingNumber && `tracking=${b.trackingNumber}`,
      b.weight && `weight=${b.weight}`,
      b.shipFromZip && `from=${b.shipFromZip}`,
      b.freightRate && `rate=$${b.freightRate}${b.freightRateLabel ? ` ${b.freightRateLabel}` : ""}`,
      b.noLabel && "no label",
    ].filter(Boolean);
    if (parts.length > 0) {
      sections.push(`[BOX ${i + 1}] ${parts.join(" / ")}`);
    }
  });

  if (session.noPackingSlip) sections.push("[PACKING SLIP] None included");
  if (session.noDocuments) sections.push("[DOCS] None included");

  for (const line of session.lineItems) {
    if (!line.confirmed) continue;
    const note = line.notes.trim();
    if (line.condition !== "good" || note) {
      const condLabel = line.condition === "good" ? "ok" : line.condition;
      sections.push(
        `[LINE ${line.lineNum + 1} / ${line.itemCode}] ${condLabel}${note ? ` — ${note}` : ""}`
      );
    }
  }

  return sections.join("\n");
}

export function ReviewSubmit() {
  const session = useSessionStore((s) => s.getActiveSession());
  const goToStep = useSessionStore((s) => s.goToStep);
  const setStatus = useSessionStore((s) => s.setStatus);
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [grpoDocNum, setGrpoDocNum] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<ReceivingUploadResult | null>(null);

  if (!session) return null;

  const isSubmitted = session.status === "SUBMITTED";
  const confirmedLines = session.lineItems.filter((l) => l.confirmed);
  const totalReceived = confirmedLines.reduce((sum, l) => sum + l.receivedQty, 0);
  const exceptions = confirmedLines.filter((l) => l.condition !== "good");
  const totalPhotos =
    session.boxPhotos.length +
    session.boxes.reduce((sum, b) => sum + b.labelPhotos.length, 0) +
    session.packingSlipPhotos.length +
    session.documents.length +
    session.lineItems.reduce(
      (sum, l) => sum + l.photos.length + l.nameplatePhotos.length + l.quantityPhotos.length,
      0,
    );

  const poDocEntry = session.poDocEntry;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      let postedDocEntry: number | null = null;
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

        const grpoDetails = buildGrpoDetails(session);
        // Aggregate per-box freight + tracking for the GRPO header. Tracking
        // numbers concat (comma-separated), freight rates sum.
        const combinedTracking = session.boxes
          .map((b) => b.trackingNumber.trim())
          .filter(Boolean)
          .join(", ");
        const totalFreight = session.boxes.reduce((sum, b) => {
          const n = parseFloat(b.freightRate);
          return isFinite(n) ? sum + n : sum;
        }, 0);
        const result = await postGRPO({
          vendorCode: session.vendorCode ?? "",
          poDocEntry,
          lines: grpoLines,
          grpoDetails: grpoDetails || undefined,
          frtTracking: combinedTracking || undefined,
          inboundFrt: totalFreight > 0 ? totalFreight : undefined,
        });

        setGrpoDocNum(result.docNum);
        postedDocEntry = result.docEntry;
      }

      // Upload photo evidence to SharePoint. Failure here does not invalidate
      // the GRPO that just posted to SAP — surface but don't block.
      let uploadOutcome: ReceivingUploadResult | null = null;
      try {
        uploadOutcome = await uploadReceivingSessionToSharePoint(session, setUploadProgress);
        setUploadResult(uploadOutcome);
      } catch (err) {
        setUploadResult({
          uploaded: 0,
          webImagesUploaded: 0,
          failed: [{
            filename: "(upload aborted)",
            error: err instanceof Error ? err.message : String(err),
            destination: "receiving",
          }],
          folder: "",
        });
      } finally {
        setUploadProgress(null);
      }

      // Stamp the SharePoint folder URL onto the posted GRPO (OPDN.U_GRPODocs)
      // so SAP users can click through to the evidence folder. Best-effort —
      // a PATCH failure must not undo the successful GRPO + upload.
      if (postedDocEntry !== null && uploadOutcome?.folderUrl && uploadOutcome.uploaded > 0) {
        try {
          await patchGrpoDocsUrl(postedDocEntry, uploadOutcome.folderUrl);
        } catch (err) {
          console.warn("[ReviewSubmit] Failed to stamp U_GRPODocs:", err);
        }
      }

      setStatus("SUBMITTED");
      if (!poDocEntry) {
        // No SAP posting — just mark done after upload attempt
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
          onClick={() => (isSubmitted ? navigate("/") : goToStep("LINES"))}
          className="text-primary text-sm font-medium px-2 py-1 -ml-2"
        >
          &larr; Back
        </button>
        <h2 className="text-lg font-semibold text-text">
          {isSubmitted ? `PO ${session.poNumber || "—"}` : "Review & Submit"}
        </h2>
        {isSubmitted && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-success ml-auto">
            Submitted
          </span>
        )}
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
          label={session.boxes.length === 1 ? "Shipping Label" : `Shipping Labels (${session.boxes.length})`}
          value={`${session.boxes.reduce((sum, b) => sum + b.labelPhotos.length, 0)} photo${
            session.boxes.reduce((sum, b) => sum + b.labelPhotos.length, 0) !== 1 ? "s" : ""
          }`}
          extra={session.carrier || undefined}
        />
        <SummaryRow
          label="Packing Slip"
          value={`PO: ${session.poNumber || "N/A"}`}
          extra={
            session.noPackingSlip
              ? "None included"
              : `${session.packingSlipPhotos.length} page${session.packingSlipPhotos.length !== 1 ? "s" : ""}`
          }
        />
        <SummaryRow
          label="Shipping Details"
          value={session.shippingDetails.transpCode || session.carrier || "—"}
          extra={session.shippingDetails.shipSpeed || undefined}
        />
        {(() => {
          const totalFreight = session.boxes.reduce((sum, b) => {
            const n = parseFloat(b.freightRate);
            return isFinite(n) ? sum + n : sum;
          }, 0);
          if (totalFreight <= 0) return null;
          const label =
            session.boxes.length === 1
              ? session.boxes[0].freightRateLabel || undefined
              : `${session.boxes.length} boxes (list)`;
          return (
            <SummaryRow
              label="UPS Rate"
              value={`$${totalFreight.toFixed(2)}`}
              extra={label}
            />
          );
        })()}
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
            className={`grid grid-cols-[1fr_60px_60px] gap-1 p-3 text-sm border-b border-border/50 items-center
                        ${l.condition !== "good" ? "bg-red-50" : ""}`}
          >
            <div className="min-w-0">
              <p className="font-medium text-text">{l.itemCode}</p>
              <p className="text-xs text-text-secondary break-words">{l.itemDescription}</p>
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

      {/* Upload progress */}
      {uploadProgress && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 animate-slide-in">
          <p className="text-sm font-medium text-text">
            Uploading photos to SharePoint ({uploadProgress.current}/{uploadProgress.total})
          </p>
          <p className="text-xs text-text-secondary truncate mt-1">{uploadProgress.fileName}</p>
        </div>
      )}

      {/* GRPO success */}
      {grpoDocNum && !uploadProgress && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-center animate-slide-in">
          <p className="text-lg font-bold text-success">GRPO Posted</p>
          <p className="text-sm text-text-secondary">Document #{grpoDocNum}</p>
          {uploadResult && (() => {
            // Receiving-folder failures matter to the receiver; web-images are a
            // background secondary copy, surface those only via console.
            const recvFailed = uploadResult.failed.filter((f) => f.destination === "receiving");
            const webFailed = uploadResult.failed.filter((f) => f.destination === "web-images");
            if (webFailed.length > 0) {
              console.warn(`[ReviewSubmit] ${webFailed.length} web-image upload(s) failed`, webFailed);
            }
            return recvFailed.length === 0 ? (
              <p className="text-xs text-text-secondary mt-2">
                {uploadResult.uploaded} photo{uploadResult.uploaded !== 1 ? "s" : ""} uploaded to SharePoint
              </p>
            ) : (
              <p className="text-xs text-error mt-2">
                {uploadResult.uploaded} uploaded, {recvFailed.length} failed — {recvFailed[0].error}
              </p>
            );
          })()}
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
          <TailscaleHint />
        </div>
      )}

      {/* Submit */}
      {!grpoDocNum && !isSubmitted && (
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

      {isSubmitted && (
        <div className="mt-auto pt-4">
          <button
            onClick={() => navigate("/")}
            className="w-full py-3 rounded-xl bg-surface border border-border text-text font-medium"
          >
            Back to Dashboard
          </button>
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
