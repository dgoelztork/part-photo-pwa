import { useCallback } from "react";
import { capturePhoto, processCapture } from "../../services/photo-service";
import type { CapturedPhoto } from "../../types/session";

interface CameraCaptureProps {
  onCapture: (photo: CapturedPhoto) => void;
  label?: string;
}

export function CameraCapture({
  onCapture,
  label = "Take Photo",
}: CameraCaptureProps) {
  const handleCapture = useCallback(async () => {
    const file = await capturePhoto();
    if (file) {
      const photo = processCapture(file);
      onCapture(photo);
    }
  }, [onCapture]);

  return (
    <button
      onClick={handleCapture}
      className="w-full py-4 rounded-xl bg-text text-white font-semibold text-base
                 flex items-center justify-center gap-2
                 active:scale-[0.98] transition-transform"
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
      {label}
    </button>
  );
}
