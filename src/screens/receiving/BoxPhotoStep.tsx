
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { CameraCapture } from "../../components/camera/CameraCapture";
import { PhotoGallery } from "../../components/camera/PhotoGallery";

interface BoxPhotoStepProps {
  onBack: () => void;
}

export function BoxPhotoStep({ onBack }: BoxPhotoStepProps) {
  const session = useSessionStore((s) => s.getActiveSession());
  const addPhoto = useSessionStore((s) => s.addBoxPhoto);
  const removePhoto = useSessionStore((s) => s.removeBoxPhoto);
  const setDamaged = useSessionStore((s) => s.setBoxDamaged);
  const setNotes = useSessionStore((s) => s.setBoxDamageNotes);
  const goToStep = useSessionStore((s) => s.goToStep);

  if (!session) return null;

  const canProceed = session.boxPhotos.length >= 1;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_1" onBack={onBack} />

      <p className="text-sm text-text-secondary">
        Photograph the shipping box as received, before opening.
      </p>

      <CameraCapture onCapture={addPhoto} label="Photograph Box" />

      <PhotoGallery photos={session.boxPhotos} onDelete={removePhoto} />

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

      <StepNavigation
        onNext={() => goToStep("STEP_2")}
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
