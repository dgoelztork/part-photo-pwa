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
import { PicklistView } from "./PicklistView";

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

  // Per-box breakdown — tracking, weight, origin ZIP, freight rate, damage per box.
  session.boxes.forEach((b, i) => {
    const parts = [
      b.trackingNumber && `tracking=${b.trackingNumber}`,
      b.weight && `weight=${b.weight}`,
      b.shipFromZip && `from=${b.shipFromZip}`,
      b.freightRate && `rate=$${b.freightRate}${b.freightRateLabel ? ` ${b.freightRateLabel}` : ""}`,
      b.noLabel && "no label",
      b.damaged && `DAMAGED${b.damageNotes.trim() ? ` — ${b.damageNotes.trim()}` : ""}`,
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

/**
 * Does this session still hold the photo bytes?
 *
 * Receipts submitted before photos were persisted come back with empty blobs,
 * and so do ones whose upload is confirmed done. Offering "upload the photos"
 * when there is nothing left to send would be a button that can only fail.
 */
function hasPhotoBytes(session: ReceivingSession): boolean {
  const any = (photos: { blob: Blob }[]) => photos.some((p) => p.blob && p.blob.size > 0);
  return (
    session.boxes.some((b) => any(b.labelPhotos) || any(b.damagePhotos)) ||
    any(session.packingSlipPhotos) ||
    session.documents.some((d) => d.photo.blob && d.photo.blob.size > 0) ||
    session.lineItems.some(
      (l) => any(l.photos) || any(l.nameplatePhotos) || any(l.quantityPhotos)
    )
  );
}

export function ReviewSubmit() {
  const session = useSessionStore((s) => s.getActiveSession());
  const goToStep = useSessionStore((s) => s.goToStep);
  const setStatus = useSessionStore((s) => s.setStatus);
  const setGrpoResult = useSessionStore((s) => s.setGrpoResult);
  const setPhotosUploaded = useSessionStore((s) => s.setPhotosUploaded);
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [grpoDocNum, setGrpoDocNum] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<ReceivingUploadResult | null>(null);
  const [showPicklist, setShowPicklist] = useState(false);
  // True while photos are still going up. Gates the buttons so nobody walks
  // away mid-upload.
  const [uploading, setUploading] = useState(false);

  if (!session) return null;

  const isSubmitted = session.status === "SUBMITTED";
  const confirmedLines = session.lineItems.filter((l) => l.confirmed);
  const totalReceived = confirmedLines.reduce((sum, l) => sum + l.receivedQty, 0);
  const exceptions = confirmedLines.filter((l) => l.condition !== "good");
  const totalPhotos =
    session.boxes.reduce((sum, b) => sum + b.labelPhotos.length + b.damagePhotos.length, 0) +
    session.packingSlipPhotos.length +
    session.documents.length +
    session.lineItems.reduce(
      (sum, l) => sum + l.photos.length + l.nameplatePhotos.length + l.quantityPhotos.length,
      0,
    );

  const poDocEntry = session.poDocEntry;

  // Qty received per item on this receipt, for the picklist's RECV column. A
  // part can appear on more than one PO line, so sum rather than overwrite.
  const receivedByItem = confirmedLines.reduce<Record<string, number>>((acc, l) => {
    acc[l.itemCode] = (acc[l.itemCode] ?? 0) + l.receivedQty;
    return acc;
  }, {});

  /**
   * Send the photos and stamp the folder URL on the GRPO. Shared by the first
   * attempt and the retry, so a retried upload behaves identically.
   *
   * Records whether it worked on the session itself: that flag is what shows
   * the retry prompt, and what tells the store it can stop carrying the photo
   * bytes on the phone.
   */
  const runUpload = async (docEntry: number | null) => {
    setUploading(true);
    let outcome: ReceivingUploadResult | null = null;
    try {
      outcome = await uploadReceivingSessionToSharePoint(session, setUploadProgress);
      setUploadResult(outcome);
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
      setUploading(false);
    }

    if (docEntry !== null && outcome?.folderUrl && outcome.uploaded > 0) {
      try {
        await patchGrpoDocsUrl(docEntry, outcome.folderUrl);
      } catch (err) {
        console.warn("[ReviewSubmit] Failed to stamp U_GRPODocs:", err);
      }
    }

    // Only a clean run counts. A partial upload leaves the phone holding the
    // only copy of what didn't make it.
    const clean =
      !!outcome && outcome.uploaded > 0 &&
      outcome.failed.filter((f) => f.destination === "receiving").length === 0;
    setPhotosUploaded(clean);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    let postedDocEntry: number | null = null;
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
            // Carry the PO line's warehouse (POR1.WarehouseCode) so receipts
            // post to the correct site — Pascagoula POs land in Pascagoula,
            // not a hardcoded default. Fallback covers sessions that were
            // already in-flight before this field existed (all warehouse-01).
            warehouse: l.warehouse || "01",
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
        // Persisted so a retry after a reload can still stamp U_GRPODocs.
        setGrpoResult(result.docEntry, result.docNum);
      }

      // GRPO is in SAP — flip status now so the receipt is recorded as done
      // even if the photo upload below fails. A SharePoint failure never
      // undoes the posted GRPO.
      setStatus("SUBMITTED");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);

    // Upload the photos with the receiver still on this screen, and don't
    // offer Done until it finishes.
    //
    // This used to be fire-and-forget: the success card rendered immediately
    // and the upload ran in the background. That reads well but doesn't
    // survive contact with a phone — a receipt is ~14 photos going to
    // SharePoint AND Azure Blob, and the moment the screen locks or the app
    // is switched away, iOS stops the page and the remaining uploads die
    // silently. GRPO 77197 landed 4 of 14 that way, and 3 of the last 4
    // receipts lost their photos entirely. The receipt itself is already safe
    // in SAP by this point; what's at stake is the evidence, which only
    // exists on the phone until it lands.
    await runUpload(postedDocEntry);

    if (!poDocEntry) {
      // No SAP posting — just mark done after the upload attempt
      navigate("/");
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
        {(() => {
          const damagedBoxes = session.boxes.filter((b) => b.damaged);
          const damagePhotoCount = damagedBoxes.reduce((sum, b) => sum + b.damagePhotos.length, 0);
          if (damagedBoxes.length === 0) return null;
          return (
            <SummaryRow
              label={damagedBoxes.length === 1 ? "Damaged Box" : `Damaged Boxes (${damagedBoxes.length})`}
              value={`${damagePhotoCount} photo${damagePhotoCount !== 1 ? "s" : ""}`}
              extra="Damage noted"
              extraColor="text-error"
            />
          );
        })()}
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

      {/* GRPO success — appears as soon as the SAP post returns. Photo upload
          to SharePoint then runs in the background; status shows below. */}
      {grpoDocNum && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-center animate-slide-in">
          <p className="text-lg font-bold text-success">GRPO Posted</p>
          <p className="text-sm text-text-secondary">Document #{grpoDocNum}</p>
          {uploadProgress && (
            <div className="mt-3">
              <p className="text-sm font-medium text-text">
                Uploading photos {uploadProgress.current} of {uploadProgress.total}
              </p>
              <div className="h-2 rounded-full bg-green-100 overflow-hidden mt-1">
                <div
                  className="h-full bg-success transition-all duration-300"
                  style={{
                    width: `${Math.round((uploadProgress.current / Math.max(1, uploadProgress.total)) * 100)}%`,
                  }}
                />
              </div>
              {/* The phone stops the page when it locks or is switched away,
                  which is exactly how photos have gone missing. */}
              <p className="text-xs text-error mt-2 font-medium">
                Keep this screen open until it finishes.
              </p>
            </div>
          )}
          {!uploadProgress && uploadResult && (() => {
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
          {/* Most of what we receive is already committed to a customer order.
              Offer the pick sheet here, while the parts are still on the bench. */}
          {/* Hidden until the photos are safely up — printing opens a system
              sheet and Done leaves the screen, both of which used to strand
              the upload half-finished. */}
          {!uploading && (
            <div className="mt-3 pt-3 border-t border-green-200">
              <p className="text-sm text-text mb-2">Print picklist for this order?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPicklist(true)}
                  className="flex-1 px-4 py-2 rounded-lg bg-surface border border-primary
                             text-primary font-medium active:scale-[0.98] transition-transform"
                >
                  Print Picklist
                </button>
                <button
                  onClick={() => navigate("/")}
                  className="flex-1 px-4 py-2 rounded-lg bg-primary text-white font-medium
                             active:scale-[0.98] transition-transform"
                >
                  Done
                </button>
              </div>
            </div>
          )}
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

      {/* A receipt whose photos never landed. Shown when the session still has
          the bytes — which is the case precisely when they didn't make it, since
          the store only stops carrying them once an upload is confirmed clean. */}
      {isSubmitted && session.photosUploaded !== true && !uploading && hasPhotoBytes(session) && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 animate-slide-in">
          <p className="text-sm font-semibold text-text">Photos didn't finish uploading</p>
          <p className="text-xs text-text-secondary mt-1">
            The receipt is safely in SAP
            {session.grpoDocNum ? ` as GRPO ${session.grpoDocNum}` : ""}, but its photos never
            reached SharePoint. They're still on this phone — send them now.
          </p>
          <button
            onClick={() => void runUpload(session.grpoDocEntry ?? null)}
            className="mt-3 w-full py-3 rounded-xl bg-primary text-white font-semibold
                       active:scale-[0.98] transition-transform"
          >
            Upload the photos
          </button>
          <p className="text-xs text-text-secondary mt-2">
            Keep this screen open until it finishes.
          </p>
        </div>
      )}

      {/* Progress for a retry, which happens outside the submit flow. */}
      {isSubmitted && uploading && uploadProgress && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
          <p className="text-sm font-medium text-text">
            Uploading photos {uploadProgress.current} of {uploadProgress.total}
          </p>
          <div className="h-2 rounded-full bg-green-100 overflow-hidden mt-1">
            <div
              className="h-full bg-success transition-all duration-300"
              style={{
                width: `${Math.round((uploadProgress.current / Math.max(1, uploadProgress.total)) * 100)}%`,
              }}
            />
          </div>
          <p className="text-xs text-error mt-2 font-medium">
            Keep this screen open until it finishes.
          </p>
        </div>
      )}

      {isSubmitted && (
        <div className="mt-auto pt-4 flex flex-col gap-2">
          {/* Reprint path for a session revisited from the dashboard. */}
          {session.poNumber && (
            <button
              onClick={() => setShowPicklist(true)}
              className="w-full py-3 rounded-xl bg-surface border border-primary text-primary font-medium"
            >
              Print Picklist
            </button>
          )}
          <button
            onClick={() => navigate("/")}
            className="w-full py-3 rounded-xl bg-surface border border-border text-text font-medium"
          >
            Back to Dashboard
          </button>
        </div>
      )}

      {showPicklist && session.poNumber && (
        <PicklistView
          poNumber={session.poNumber}
          grpoDocNum={grpoDocNum}
          receivedByItem={receivedByItem}
          onClose={() => setShowPicklist(false)}
        />
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
