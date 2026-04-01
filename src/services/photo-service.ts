import type { CapturedPhoto } from "../types/session";

/** Prompt native camera and return a File. */
export function capturePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  });
}

/** Create a CapturedPhoto from a File. */
export function processCapture(file: File): CapturedPhoto {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    blob: file,
    thumbnailUrl: URL.createObjectURL(file),
    timestamp: new Date().toISOString(),
  };
}

/** Revoke all thumbnail URLs to free memory. */
export function revokePhotos(photos: CapturedPhoto[]): void {
  for (const photo of photos) {
    if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
  }
}
