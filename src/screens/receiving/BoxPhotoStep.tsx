import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";
import { extractShippingLabel } from "../../services/api-client";
import { decodeShippingLabelBarcode } from "../../lib/barcode-reader";
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
  const setShipmentBoxCount = useSessionStore((s) => s.setShipmentBoxCount);
  const setCarrier = useSessionStore((s) => s.setCarrier);
  const addShippingBox = useSessionStore((s) => s.addShippingBox);
  const removeShippingBox = useSessionStore((s) => s.removeShippingBox);
  const updateShippingBox = useSessionStore((s) => s.updateShippingBox);
  const addShippingBoxDamagePhoto = useSessionStore((s) => s.addShippingBoxDamagePhoto);
  const removeShippingBoxDamagePhoto = useSessionStore((s) => s.removeShippingBoxDamagePhoto);
  const goToStep = useSessionStore((s) => s.goToStep);

  // Local text mirror of shipmentBoxCount so users can clear the field and
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
  // A box is "missing required damage info" if marked damaged but no damage
  // photo and no notes provided.
  const damageOk = session.boxes.every(
    (b) => !b.damaged || b.damagePhotos.length >= 1 || b.damageNotes.trim().length > 0,
  );
  const canProceed =
    !!session.carrier && labelsCaptured >= target && damageOk;

  // Fire-and-forget barcode + OCR. The box is created immediately so the
  // receiver can keep capturing labels for the next box while the previous
  // one is still being read. Per-box `extracting` flag drives the spinner.
  const runExtraction = (boxId: string, photo: CapturedPhoto) => {
    updateShippingBox(boxId, { extracting: true });
    void Promise.all([
      decodeShippingLabelBarcode(photo.blob),
      extractShippingLabel(photo.blob),
    ])
      .then(([barcodeHit, ocrFields]) => {
        const carrier = barcodeHit?.carrier ?? ocrFields.carrier;
        const trackingNumber = barcodeHit?.trackingNumber ?? ocrFields.trackingNumber;
        const updates: Partial<ShippingBox> = { extracting: false };
        if (trackingNumber) updates.trackingNumber = trackingNumber;
        if (ocrFields.weight) updates.weight = ocrFields.weight;
        if (ocrFields.shipFrom) updates.shipFromZip = ocrFields.shipFrom;
        updateShippingBox(boxId, updates);
        // Carrier is shipment-level; set it from the first box's label if
        // the user hasn't picked one yet.
        if (carrier && !useSessionStore.getState().getActiveSession()?.carrier) {
          setCarrier(carrier as Carrier);
        }
      })
      .catch((err) => {
        console.warn("[BoxPhotoStep] Label extraction failed:", err);
        updateShippingBox(boxId, { extracting: false });
      });
  };

  const handleLabelCapture = (photo: CapturedPhoto) => {
    const boxId = addShippingBox({ labelPhotos: [photo] });
    runExtraction(boxId, photo);
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

      {/* Per-box label capture + damage */}
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

        {/* List of captured boxes with per-box damage controls */}
        {session.boxes.length > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            {session.boxes.map((b, i) => (
              <BoxCard
                key={b.id}
                index={i}
                box={b}
                onRemove={() => removeShippingBox(b.id)}
                onSetDamaged={(damaged) => updateShippingBox(b.id, { damaged })}
                onSetDamageNotes={(notes) => updateShippingBox(b.id, { damageNotes: notes })}
                onAddDamagePhoto={(photo) => addShippingBoxDamagePhoto(b.id, photo)}
                onRemoveDamagePhoto={(photoId) => removeShippingBoxDamagePhoto(b.id, photoId)}
              />
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
            Pick a carrier, capture {target} label{target > 1 ? "s" : ""}, and document any damaged boxes to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}

function BoxCard({
  index,
  box,
  onRemove,
  onSetDamaged,
  onSetDamageNotes,
  onAddDamagePhoto,
  onRemoveDamagePhoto,
}: {
  index: number;
  box: ShippingBox;
  onRemove: () => void;
  onSetDamaged: (damaged: boolean) => void;
  onSetDamageNotes: (notes: string) => void;
  onAddDamagePhoto: (photo: CapturedPhoto) => void;
  onRemoveDamagePhoto: (photoId: string) => void;
}) {
  return (
    <div className="bg-surface rounded-xl p-3 shadow-sm flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {box.labelPhotos[0]?.thumbnailUrl ? (
          <img
            src={box.labelPhotos[0].thumbnailUrl}
            alt={`Box ${index + 1} label`}
            className="w-12 h-12 rounded-lg object-cover border border-border"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-bg border border-dashed border-border flex items-center justify-center text-xs text-text-secondary">
            no label
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text">Box {index + 1}</p>
          <p className="text-xs text-text-secondary truncate">
            {box.extracting
              ? "Reading label…"
              : box.trackingNumber || (box.noLabel ? "No label" : "—")}
            {!box.extracting && box.weight ? ` · ${box.weight}` : ""}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="text-text-secondary text-sm px-2 py-1"
          aria-label={`Remove box ${index + 1}`}
        >
          &times;
        </button>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={box.damaged}
          onChange={(e) => onSetDamaged(e.target.checked)}
          className="w-5 h-5 accent-error"
        />
        <span className="text-sm font-medium text-text">This box is damaged</span>
      </label>

      {box.damaged && (
        <div className="flex flex-col gap-2 animate-slide-in">
          <CameraCapture onCapture={onAddDamagePhoto} label="Photograph Damage" />
          <PhotoGallery photos={box.damagePhotos} onDelete={onRemoveDamagePhoto} />
          <textarea
            value={box.damageNotes}
            onChange={(e) => onSetDamageNotes(e.target.value)}
            placeholder="Describe the damage..."
            className="w-full p-3 rounded-lg border border-border text-base resize-none"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
