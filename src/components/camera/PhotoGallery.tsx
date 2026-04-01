import { useState } from "react";
import type { CapturedPhoto } from "../../types/session";

interface PhotoGalleryProps {
  photos: CapturedPhoto[];
  onDelete?: (photoId: string) => void;
}

export function PhotoGallery({ photos, onDelete }: PhotoGalleryProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewPhoto = photos.find((p) => p.id === previewId);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative rounded-lg overflow-hidden bg-surface shadow-sm"
          >
            <img
              src={photo.thumbnailUrl}
              alt=""
              className="w-full aspect-square object-cover cursor-pointer"
              onClick={() => setPreviewId(photo.id)}
            />
            {onDelete && (
              <button
                onClick={() => onDelete(photo.id)}
                className="absolute top-1 right-1 w-7 h-7 rounded-full
                           bg-black/60 text-white text-sm flex items-center justify-center"
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Full-screen preview */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setPreviewId(null)}
        >
          <img
            src={previewPhoto.thumbnailUrl}
            alt=""
            className="max-w-full max-h-full object-contain"
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl"
            onClick={() => setPreviewId(null)}
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
