import { useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import { extractShippingLabel } from "../../services/api-client";
import { decodeShippingLabelBarcode } from "../../lib/barcode-reader";
import { TailscaleHint } from "../../components/TailscaleHint";
import type { CapturedPhoto } from "../../types/session";

interface BoxPhotoStepProps {
  onBack: () => void;
}

export function BoxPhotoStep({ onBack }: BoxPhotoStepProps) {
  const session = useSessionStore((s) => s.getActiveSession());
  const addBoxPhoto = useSessionStore((s) => s.addBoxPhoto);
  const removeBoxPhoto = useSessionStore((s) => s.removeBoxPhoto);
  const setShipmentBoxCount = useSessionStore((s) => s.setShipmentBoxCount);
  const setDamaged = useSessionStore((s) => s.setBoxDamaged);
  const setNotes = useSessionStore((s) => s.setBoxDamageNotes);
  const addLabelPhoto = useSessionStore((s) => s.addLabelPhoto);
  const removeLabelPhoto = useSessionStore((s) => s.removeLabelPhoto);
  const updateInfo = useSessionStore((s) => s.updateShippingInfo);
  const goToStep = useSessionStore((s) => s.goToStep);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  if (!session) return null;

  const canProceed =
    session.boxPhotos.length >= 1 && session.labelPhotos.length >= 1 && !extracting;
  const info = session.shippingInfo;

  // Hybrid extraction: barcode scan (local, fast, 100% accurate when it
  // decodes) and vision OCR (remote, fills the fields the barcode doesn't
  // carry) run in parallel. Barcode wins for tracking + carrier; OCR
  // supplies weight, ZIPs, and service speed. Then fill blanks only so a
  // manual entry isn't overwritten. The structured fields aren't shown on
  // this step anymore — they're consumed later as defaults on the
  // SHIPPING_DETAILS step.
  const handleLabelCapture = async (photo: CapturedPhoto) => {
    addLabelPhoto(photo);
    setExtractError(null);
    setExtracting(true);
    try {
      const [barcodeHit, ocrFields] = await Promise.all([
        decodeShippingLabelBarcode(photo.blob),
        extractShippingLabel(photo.blob),
      ]);

      // Barcode-derived tracking + carrier override OCR equivalents.
      // Everything else comes from OCR.
      const carrier = barcodeHit?.carrier ?? ocrFields.carrier;
      const trackingNumber = barcodeHit?.trackingNumber ?? ocrFields.trackingNumber;

      const patch: Partial<typeof info> = {};
      if (carrier && !info.carrier) patch.carrier = carrier;
      if (trackingNumber && !info.trackingNumber) patch.trackingNumber = trackingNumber;
      if (ocrFields.weight && !info.weight) patch.weight = ocrFields.weight;
      if (ocrFields.shipFrom && !info.shipFrom) patch.shipFrom = ocrFields.shipFrom;
      if (ocrFields.shipToZip && !info.shipToZip) patch.shipToZip = ocrFields.shipToZip;
      if (ocrFields.shippingSpeed && !info.shippingSpeed) patch.shippingSpeed = ocrFields.shippingSpeed;
      if (Object.keys(patch).length > 0) updateInfo(patch);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="BOX" onBack={onBack} />

      {/* Number of boxes in this shipment */}
      <div className="bg-surface rounded-xl p-4 shadow-sm flex items-center justify-between">
        <label htmlFor="shipment-box-count" className="text-sm font-medium text-text">
          Boxes in this shipment
        </label>
        <input
          id="shipment-box-count"
          type="number"
          inputMode="numeric"
          min={1}
          value={session.shipmentBoxCount}
          onChange={(e) => setShipmentBoxCount(Number(e.target.value) || 1)}
          className="w-24 p-3 rounded-lg border border-border text-2xl font-bold text-center"
        />
      </div>

      {/* Box photos */}
      <p className="text-sm text-text-secondary">
        Photograph the shipping box as received, before opening.
      </p>
      <CameraCapture onCapture={addBoxPhoto} label="Photograph Box" />
      <PhotoGallery photos={session.boxPhotos} onDelete={removeBoxPhoto} />

      {session.boxPhotos.length > 0 && (
        <div className="bg-surface rounded-xl p-4 shadow-sm animate-slide-in">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={session.boxDamaged}
              onChange={(e) => setDamaged(e.target.checked)}
              className="w-5 h-5 accent-error"
            />
            <span className="font-medium text-text">Box appears damaged</span>
          </label>

          {session.boxDamaged && (
            <textarea
              value={session.boxDamageNotes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the damage..."
              className="mt-3 w-full p-3 rounded-lg border border-border text-base resize-none"
              rows={3}
            />
          )}
        </div>
      )}

      {/* Shipping label photos */}
      <div className="border-t border-border pt-4 mt-2">
        <p className="text-sm text-text-secondary mb-3">
          Now photograph the shipping label clearly.
        </p>
        <CameraCapture onCapture={handleLabelCapture} label="Photograph Label" />
        <PhotoGallery photos={session.labelPhotos} onDelete={removeLabelPhoto} />
        {extracting && (
          <p className="text-sm text-text-secondary text-center animate-pulse mt-2">
            Reading label...
          </p>
        )}
        {extractError && (
          <div className="mt-2 p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-xs text-error text-center">
              Couldn't auto-fill from photo ({extractError}). You can edit shipping details on a later step.
            </p>
            <TailscaleHint />
          </div>
        )}
      </div>

      <StepNavigation
        onNext={() => goToStep("CARRIER")}
        nextDisabled={!canProceed}
      >
        {!canProceed && (
          <p className="text-center text-sm text-text-secondary">
            Take at least 1 box photo and 1 label photo to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}
