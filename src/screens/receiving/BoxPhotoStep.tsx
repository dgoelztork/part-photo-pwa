import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import { extractShippingLabel } from "../../services/api-client";
import { decodeShippingLabelBarcode } from "../../lib/barcode-reader";
import { TailscaleHint } from "../../components/TailscaleHint";
import type { CapturedPhoto, Carrier, ShippingBox } from "../../types/session";

const CARRIER_OPTIONS: Array<{
  id: Carrier;
  label: string;
  selectedClass: string;
  unselectedClass: string;
}> = [
  {
    id: "UPS",
    label: "UPS",
    selectedClass: "bg-amber-800 text-white border-amber-900",
    unselectedClass: "bg-amber-50 text-amber-900 border-amber-200",
  },
  {
    id: "FedEx",
    label: "FedEx",
    selectedClass: "bg-purple-700 text-white border-purple-800",
    unselectedClass: "bg-purple-50 text-purple-900 border-purple-200",
  },
  {
    id: "LTL",
    label: "LTL",
    selectedClass: "bg-blue-700 text-white border-blue-800",
    unselectedClass: "bg-blue-50 text-blue-900 border-blue-200",
  },
  {
    id: "Other",
    label: "Other",
    selectedClass: "bg-gray-700 text-white border-gray-800",
    unselectedClass: "bg-gray-100 text-gray-900 border-gray-300",
  },
];

interface BoxPhotoStepProps {
  onBack: () => void;
}

export function BoxPhotoStep({ onBack }: BoxPhotoStepProps) {
  const session = useSessionStore((s) => s.getActiveSession());
  const addBoxPhoto = useSessionStore((s) => s.addBoxPhoto);
  const removeBoxPhoto = useSessionStore((s) => s.removeBoxPhoto);
  const setShipmentBoxCount = useSessionStore((s) => s.setShipmentBoxCount);
  const setCarrier = useSessionStore((s) => s.setCarrier);
  const setDamaged = useSessionStore((s) => s.setBoxDamaged);
  const setNotes = useSessionStore((s) => s.setBoxDamageNotes);
  const addShippingBox = useSessionStore((s) => s.addShippingBox);
  const removeShippingBox = useSessionStore((s) => s.removeShippingBox);
  const updateShippingBox = useSessionStore((s) => s.updateShippingBox);
  const goToStep = useSessionStore((s) => s.goToStep);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  // Local text mirror of shipmentBoxCount so the user can clear the field and
  // type a new value without the onChange handler snapping it back to 1.
  const [boxCountText, setBoxCountText] = useState<string>(
    session ? String(session.shipmentBoxCount) : "1",
  );
  useEffect(() => {
    if (session) setBoxCountText(String(session.shipmentBoxCount));
  }, [session?.shipmentBoxCount]);

  if (!session) return null;

  const labelsCaptured = session.boxes.length;
  const target = session.shipmentBoxCount;
  const canProceed =
    session.boxPhotos.length >= 1 &&
    !!session.carrier &&
    labelsCaptured >= target &&
    !extracting;

  // Hybrid extraction: barcode scan (local, fast, 100% accurate when it
  // decodes) and vision OCR (remote, fills the fields the barcode doesn't
  // carry) run in parallel. Each labeled box gets its own ShippingBox entry
  // populated from the extraction so the ShippingDetails step can show the
  // per-box breakdown and quote UPS rates per box.
  const handleLabelCapture = async (photo: CapturedPhoto) => {
    setExtractError(null);
    setExtracting(true);
    const boxId = addShippingBox({ labelPhotos: [photo] });
    try {
      const [barcodeHit, ocrFields] = await Promise.all([
        decodeShippingLabelBarcode(photo.blob),
        extractShippingLabel(photo.blob),
      ]);

      const carrier = barcodeHit?.carrier ?? ocrFields.carrier;
      const trackingNumber = barcodeHit?.trackingNumber ?? ocrFields.trackingNumber;
      const updates: Partial<ShippingBox> = {};
      if (trackingNumber) updates.trackingNumber = trackingNumber;
      if (ocrFields.weight) updates.weight = ocrFields.weight;
      if (ocrFields.shipFrom) updates.shipFromZip = ocrFields.shipFrom;
      if (Object.keys(updates).length > 0) updateShippingBox(boxId, updates);

      // Carrier is shipment-level; set it from the first box's label if not
      // already chosen by the user.
      if (carrier && !session.carrier) setCarrier(carrier as Carrier);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const addNoLabelBox = () => {
    addShippingBox({ noLabel: true });
  };

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="BOX" onBack={onBack} />

      {/* Carrier selection */}
      <div>
        <p className="text-sm font-medium text-text mb-2">Carrier</p>
        <div className="grid grid-cols-4 gap-2">
          {CARRIER_OPTIONS.map((opt) => {
            const isSelected = session.carrier === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setCarrier(opt.id)}
                className={`py-3 rounded-xl border-2 font-bold text-sm
                            active:scale-[0.98] transition-transform
                            ${isSelected ? opt.selectedClass : opt.unselectedClass}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Number of boxes in this shipment */}
      <div className="bg-surface rounded-xl p-4 shadow-sm flex items-center justify-between">
        <label htmlFor="shipment-box-count" className="text-sm font-medium text-text">
          Boxes in this shipment
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShipmentBoxCount(Math.max(1, target - 1))}
            disabled={target <= 1}
            aria-label="Decrease box count"
            className="w-11 h-11 rounded-lg border-2 border-border text-2xl font-bold text-text disabled:opacity-30 active:scale-95 transition-transform"
          >
            −
          </button>
          <input
            id="shipment-box-count"
            type="number"
            inputMode="numeric"
            min={1}
            value={boxCountText}
            onChange={(e) => {
              setBoxCountText(e.target.value);
              const n = parseInt(e.target.value, 10);
              if (isFinite(n) && n >= 1) setShipmentBoxCount(n);
            }}
            onBlur={() => {
              // Snap back to the committed session value if user left an invalid string.
              const n = parseInt(boxCountText, 10);
              if (!isFinite(n) || n < 1) setBoxCountText(String(target));
            }}
            className="w-16 p-2 rounded-lg border border-border text-2xl font-bold text-center"
          />
          <button
            type="button"
            onClick={() => setShipmentBoxCount(target + 1)}
            aria-label="Increase box count"
            className="w-11 h-11 rounded-lg border-2 border-border text-2xl font-bold text-text active:scale-95 transition-transform"
          >
            +
          </button>
        </div>
      </div>

      {/* Outer box photos */}
      <p className="text-sm text-text-secondary">
        Photograph the shipping box(es) as received, before opening.
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

      {/* Per-box label capture */}
      <div className="border-t border-border pt-4 mt-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-text">Shipping labels</p>
          <p className="text-xs text-text-secondary">
            {labelsCaptured} of {target} captured
          </p>
        </div>
        <p className="text-sm text-text-secondary mb-3">
          Photograph the label on each box. Each label captures its own tracking and weight.
        </p>
        <CameraCapture
          onCapture={handleLabelCapture}
          label={
            labelsCaptured === 0
              ? "Photograph Label"
              : `Photograph Label (Box ${labelsCaptured + 1})`
          }
        />
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

        {/* List of captured boxes */}
        {session.boxes.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {session.boxes.map((b, i) => (
              <div
                key={b.id}
                className="bg-surface rounded-xl p-3 shadow-sm flex items-center gap-3"
              >
                {b.labelPhotos[0]?.thumbnailUrl ? (
                  <img
                    src={b.labelPhotos[0].thumbnailUrl}
                    alt={`Box ${i + 1} label`}
                    className="w-12 h-12 rounded-lg object-cover border border-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-bg border border-dashed border-border flex items-center justify-center text-xs text-text-secondary">
                    no label
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text">Box {i + 1}</p>
                  <p className="text-xs text-text-secondary truncate">
                    {b.trackingNumber || (b.noLabel ? "No label" : "Reading...")}
                    {b.weight ? ` · ${b.weight}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeShippingBox(b.id)}
                  className="text-text-secondary text-sm px-2 py-1"
                  aria-label={`Remove box ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {/* "No label" escape hatch when one box really has no label */}
        {labelsCaptured < target && (
          <button
            onClick={addNoLabelBox}
            className="mt-2 text-xs text-primary underline self-start"
          >
            This box had no label
          </button>
        )}
      </div>

      <StepNavigation
        onNext={() => goToStep("PACKING_SLIP")}
        nextDisabled={!canProceed}
      >
        {!canProceed && (
          <p className="text-center text-sm text-text-secondary">
            Select a carrier, photograph at least one box, and capture {target} label{target > 1 ? "s" : ""} to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}
