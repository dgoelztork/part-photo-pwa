import { useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import { extractShippingLabel } from "../../services/api-client";
import type { CapturedPhoto } from "../../types/session";

export function ShippingLabelStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const addPhoto = useSessionStore((s) => s.addLabelPhoto);
  const removePhoto = useSessionStore((s) => s.removeLabelPhoto);
  const updateInfo = useSessionStore((s) => s.updateShippingInfo);
  const goToStep = useSessionStore((s) => s.goToStep);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  if (!session) return null;

  const canProceed = session.labelPhotos.length >= 1;
  const info = session.shippingInfo;

  // Auto-extract fields from the photo. Only fills in fields the user hasn't already typed,
  // so a manual entry is never silently overwritten.
  const handlePhotoCapture = async (photo: CapturedPhoto) => {
    addPhoto(photo);
    setExtractError(null);
    setExtracting(true);
    try {
      const fields = await extractShippingLabel(photo.blob);
      const patch: Partial<typeof info> = {};
      if (fields.carrier && !info.carrier) patch.carrier = fields.carrier;
      if (fields.trackingNumber && !info.trackingNumber) patch.trackingNumber = fields.trackingNumber;
      if (fields.weight && !info.weight) patch.weight = fields.weight;
      if (fields.shipFrom && !info.shipFrom) patch.shipFrom = fields.shipFrom;
      if (fields.shippingSpeed && !info.shippingSpeed) patch.shippingSpeed = fields.shippingSpeed;
      if (Object.keys(patch).length > 0) updateInfo(patch);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_2" onBack={() => goToStep("STEP_1")} />

      <p className="text-sm text-text-secondary">
        Photograph the shipping label clearly.
      </p>

      <CameraCapture onCapture={handlePhotoCapture} label="Photograph Label" />

      <PhotoGallery photos={session.labelPhotos} onDelete={removePhoto} />

      {extracting && (
        <p className="text-sm text-text-secondary text-center animate-pulse">
          Reading label...
        </p>
      )}
      {extractError && (
        <p className="text-xs text-error text-center">
          Couldn't auto-fill from photo ({extractError}). Enter fields manually below.
        </p>
      )}

      {/* Shipping info fields */}
      <div className="bg-surface rounded-xl p-4 shadow-sm flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text-secondary">Shipping Details (optional)</h3>

        <input
          type="text"
          value={info.carrier}
          onChange={(e) => updateInfo({ carrier: e.target.value })}
          placeholder="Carrier (e.g. FedEx, UPS)"
          className="w-full p-3 rounded-lg border border-border text-base"
        />
        <input
          type="text"
          value={info.trackingNumber}
          onChange={(e) => updateInfo({ trackingNumber: e.target.value })}
          placeholder="Tracking number"
          className="w-full p-3 rounded-lg border border-border text-base"
        />
        <input
          type="text"
          value={info.shippingSpeed}
          onChange={(e) => updateInfo({ shippingSpeed: e.target.value })}
          placeholder="Shipping speed (e.g. Ground, Next Day Air)"
          className="w-full p-3 rounded-lg border border-border text-base"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={info.weight}
            onChange={(e) => updateInfo({ weight: e.target.value })}
            placeholder="Weight (lbs)"
            inputMode="decimal"
            className="flex-1 p-3 rounded-lg border border-border text-base"
          />
          <input
            type="text"
            value={info.shipFrom}
            onChange={(e) => updateInfo({ shipFrom: e.target.value })}
            placeholder="Ship-from ZIP"
            inputMode="numeric"
            className="flex-1 p-3 rounded-lg border border-border text-base"
          />
        </div>
      </div>

      <StepNavigation
        onNext={() => goToStep("STEP_3")}
        nextDisabled={!canProceed}
      >
        {!canProceed && (
          <p className="text-center text-sm text-text-secondary">
            Take at least 1 photo to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}
