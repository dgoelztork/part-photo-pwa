
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";

export function ShippingLabelStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const addPhoto = useSessionStore((s) => s.addLabelPhoto);
  const removePhoto = useSessionStore((s) => s.removeLabelPhoto);
  const updateInfo = useSessionStore((s) => s.updateShippingInfo);
  const goToStep = useSessionStore((s) => s.goToStep);

  if (!session) return null;

  const canProceed = session.labelPhotos.length >= 1;
  const info = session.shippingInfo;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_2" onBack={() => goToStep("STEP_1")} />

      <p className="text-sm text-text-secondary">
        Photograph the shipping label clearly.
      </p>

      <CameraCapture onCapture={addPhoto} label="Photograph Label" />

      <PhotoGallery photos={session.labelPhotos} onDelete={removePhoto} />

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
        <div className="flex gap-2">
          <input
            type="text"
            value={info.weight}
            onChange={(e) => updateInfo({ weight: e.target.value })}
            placeholder="Weight"
            className="flex-1 p-3 rounded-lg border border-border text-base"
          />
          <input
            type="text"
            value={info.shipFrom}
            onChange={(e) => updateInfo({ shipFrom: e.target.value })}
            placeholder="Ship from"
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
