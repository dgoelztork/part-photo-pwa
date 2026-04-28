import { useState, useCallback } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import { captureDocument, processDocumentCapture } from "../../services/photo-service";
import { lookupPO, type POResult } from "../../services/api-client";
import type { ReceivingLine } from "../../types/session";

export function PackingSlipStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const addPhoto = useSessionStore((s) => s.addPackingSlipPhoto);
  const removePhoto = useSessionStore((s) => s.removePackingSlipPhoto);
  const setPoNumber = useSessionStore((s) => s.setPoNumber);
  const setPoStoreData = useSessionStore((s) => s.setPoData);
  const setLineItems = useSessionStore((s) => s.setLineItems);
  const goToStep = useSessionStore((s) => s.goToStep);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [poData, setPoData] = useState<POResult | null>(null);
  const [poError, setPoError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // Capture flow accepts photos OR scanner-produced PDFs. OCR runs on images only;
  // multi-page scans skip OCR (Tesseract can't read PDFs in-browser without PDF.js).
  const handleCapture = useCallback(async () => {
    const file = await captureDocument();
    if (!file) return;
    setCapturing(true);
    try {
      const isImage = file.type !== "application/pdf";
      if (isImage) {
        setOcrStatus("Reading packing slip...");
        try {
          const { recognizePartNumber } = await import("../../lib/ocr-reader");
          const result = await recognizePartNumber(file);
          if (result) {
            setPoNumber(result);
            setOcrStatus(`Found: ${result}`);
          } else {
            setOcrStatus("No PO number detected — enter manually below");
          }
        } catch {
          setOcrStatus("OCR unavailable — enter PO number manually");
        }
        setTimeout(() => setOcrStatus(null), 3000);
      }
      const photo = await processDocumentCapture(file);
      addPhoto(photo);
    } finally {
      setCapturing(false);
    }
  }, [addPhoto, setPoNumber]);

  const handleLookupPO = useCallback(async () => {
    if (!session?.poNumber.trim()) return;
    setLookingUp(true);
    setPoError(null);
    setPoData(null);

    try {
      const result = await lookupPO(session.poNumber.trim());
      setPoData(result);
      setPoStoreData(result.docEntry, result.vendorCode, result.vendorName);

      // Pre-populate line items from SAP PO data
      const lines: ReceivingLine[] = result.lines.map((l) => ({
        lineNum: l.lineNum,
        itemCode: l.itemCode,
        itemDescription: l.itemDescription,
        orderedQty: l.orderedQty,
        previouslyReceivedQty: l.orderedQty - l.openQty,
        openQty: l.openQty,
        receivedQty: l.openQty, // Default to receiving full open qty
        condition: "good",
        notes: "",
        photos: [],
        confirmed: false,
      }));
      setLineItems(lines);
    } catch (err) {
      setPoError(err instanceof Error ? err.message : "PO lookup failed");
    } finally {
      setLookingUp(false);
    }
  }, [session?.poNumber, setLineItems]);

  if (!session) return null;

  const hasPhotos = session.packingSlipPhotos.length >= 1;
  const hasPO = session.poNumber.trim().length > 0;
  // Allow proceeding if PO is entered (lookup is optional — proxy may not be available)
  const canProceed = hasPhotos && hasPO;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_3" onBack={() => goToStep("STEP_2")} />

      <p className="text-sm text-text-secondary">
        Capture the packing slip. On iPhone, tap{" "}
        <span className="font-medium">Choose Files → Scan Documents</span> for a clean
        multi-page PDF, or take a photo for instant PO-number OCR.
      </p>

      <button
        onClick={handleCapture}
        disabled={capturing}
        className="w-full py-4 rounded-xl bg-text text-white font-semibold text-base
                   flex items-center justify-center gap-2
                   active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {capturing ? "Processing…" : "Add Packing Slip"}
      </button>

      {ocrStatus && (
        <p className="text-center text-sm text-text-secondary animate-pulse-dot">
          {ocrStatus}
        </p>
      )}

      <PhotoGallery photos={session.packingSlipPhotos} onDelete={removePhoto} />

      {/* PO Number entry + lookup */}
      <div className="bg-surface rounded-xl p-4 shadow-sm">
        <label className="block text-sm font-medium text-text-secondary mb-2">
          PO Number
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={session.poNumber}
            onChange={(e) => {
              setPoNumber(e.target.value.toUpperCase());
              setPoData(null);
              setPoError(null);
            }}
            placeholder="Enter PO number"
            className="flex-1 p-3 rounded-lg border border-border text-lg font-semibold
                       uppercase tracking-wider"
            onKeyDown={(e) => e.key === "Enter" && handleLookupPO()}
          />
          <button
            onClick={handleLookupPO}
            disabled={!hasPO || lookingUp}
            className="px-4 py-3 rounded-lg bg-primary text-white font-medium text-sm
                       disabled:opacity-40 whitespace-nowrap"
          >
            {lookingUp ? "..." : "Look Up"}
          </button>
        </div>

        {/* PO lookup result */}
        {poData && (
          <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200 animate-slide-in">
            <p className="font-semibold text-text">{poData.vendorName}</p>
            <p className="text-sm text-text-secondary">
              PO {poData.docNum} &middot; {poData.orderDate}
            </p>
            <p className="text-sm text-success mt-1">
              {poData.openLineCount} open line{poData.openLineCount !== 1 ? "s" : ""} ready to receive
            </p>
          </div>
        )}

        {/* PO lookup error */}
        {poError && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-slide-in">
            <p className="text-sm text-error">{poError}</p>
            <p className="text-xs text-text-secondary mt-1">
              You can still proceed with manual entry
            </p>
          </div>
        )}

        {hasPO && !poData && !poError && !lookingUp && (
          <p className="mt-2 text-xs text-text-secondary">
            Tap &ldquo;Look Up&rdquo; to fetch PO details from SAP
          </p>
        )}
      </div>

      <StepNavigation
        onNext={() => goToStep("STEP_4")}
        nextDisabled={!canProceed}
      >
        {!canProceed && (
          <p className="text-center text-sm text-text-secondary">
            {!hasPhotos
              ? "Take at least 1 photo to continue"
              : "Enter PO number to continue"}
          </p>
        )}
      </StepNavigation>
    </div>
  );
}
