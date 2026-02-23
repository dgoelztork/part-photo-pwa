import type { CapturedPhoto } from "../types";

/** Build a filename from part info and sequence number. */
export function buildFileName(
  partNumber: string,
  description: string,
  index: number
): string {
  const safeDesc = description
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-]/g, "")
    .substring(0, 80);

  const seq = String(index + 1).padStart(3, "0");
  return `${partNumber}_${safeDesc}_${seq}.jpg`;
}

/** Prompt the user to take a photo using the native camera. */
export function capturePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";

    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    };

    // Some browsers need the input in the DOM
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();

    // Clean up if user cancels (no change event fires reliably on cancel)
    // We leave the input in DOM briefly; it's hidden and harmless
  });
}

/** Create a thumbnail object URL from a file. */
export function createThumbnail(file: File | Blob): string {
  return URL.createObjectURL(file);
}

/** Convert a captured file into a CapturedPhoto object. */
export function processCapture(
  file: File,
  partNumber: string,
  description: string,
  index: number
): CapturedPhoto {
  return {
    originalFile: file,
    blob: file,
    thumbnailUrl: createThumbnail(file),
    finalName: buildFileName(partNumber, description, index),
  };
}

/** Clean up thumbnail URLs to free memory. */
export function revokePhotos(photos: CapturedPhoto[]): void {
  for (const photo of photos) {
    URL.revokeObjectURL(photo.thumbnailUrl);
  }
}
