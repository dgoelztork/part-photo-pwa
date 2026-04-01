import { useState, useCallback } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import type { CapturedPhoto } from "../../types/session";

export function PackingSlipStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const addPhoto = useSessionStore((s) => s.addPackingSlipPhoto);
  const removePhoto = useSessionStore((s) => s.removePackingSlipPhoto);
  const setPoNumber = useSessionStore((s) => s.setPoNumber);
  const goToStep = useSessionStore((s) => s.goToStep);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);

  const handleCapture = useCallback(
    async (photo: CapturedPhoto) => {
      addPhoto(photo);

      // Attempt OCR for PO number
      setOcrStatus("Reading packing slip...");
      try {
        const { recognizePartNumber } = await import("../../lib/ocr-reader");
        const result = await recognizePartNumber(photo.blob);
        if (result) {
          // OCR found an M-number — check if it could be a PO number
          setPoNumber(result);
          setOcrStatus(`Found: ${result}`);
        } else {
          setOcrStatus("No PO number detected — enter manually below");
        }
      } catch {
        setOcrStatus("OCR unavailable — enter PO number manually");
      }
      setTimeout(() => setOcrStatus(null), 3000);
    },
    [addPhoto, setPoNumber]
  );

  if (!session) return null;

  const hasPhotos = session.packingSlipPhotos.length >= 1;
  const hasPO = session.poNumber.trim().length > 0;
  const canProceed = hasPhotos && hasPO;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_3" onBack={() => goToStep("STEP_2")} />

      <p className="text-sm text-text-secondary">
        Photograph each page of the packing slip. The PO number will be extracted automatically.
      </p>

      <CameraCapture onCapture={handleCapture} label="Photograph Packing Slip" />

      {ocrStatus && (
        <p className="text-center text-sm text-text-secondary animate-pulse-dot">
          {ocrStatus}
        </p>
      )}

      <PhotoGallery photos={session.packingSlipPhotos} onDelete={removePhoto} />

      {/* PO Number entry */}
      <div className="bg-surface rounded-xl p-4 shadow-sm">
        <label className="block text-sm font-medium text-text-secondary mb-2">
          PO Number
        </label>
        <input
          type="text"
          value={session.poNumber}
          onChange={(e) => setPoNumber(e.target.value.toUpperCase())}
          placeholder="Enter PO number"
          className="w-full p-3 rounded-lg border border-border text-lg font-semibold
                     uppercase tracking-wider"
        />
        {hasPO && (
          <p className="mt-2 text-xs text-text-secondary">
            SAP PO lookup will be available in Phase 2
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
