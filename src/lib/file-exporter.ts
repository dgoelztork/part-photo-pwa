import { uploadFile } from "./graph-client";
import type { CapturedPhoto } from "../types";
import JSZip from "jszip";

export interface UploadProgress {
  current: number;
  total: number;
  fileName: string;
}

/** Upload photos to OneDrive via Graph API. Calls onProgress for each file. */
export async function uploadPhotosToOneDrive(
  photos: CapturedPhoto[],
  folderPath: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    onProgress?.({
      current: i + 1,
      total: photos.length,
      fileName: photo.finalName,
    });

    await uploadFile(folderPath, photo.finalName, photo.blob, "image/jpeg");
  }
}

/** Download all photos as a ZIP file (fallback for offline/errors). */
export async function downloadAsZip(
  photos: CapturedPhoto[]
): Promise<void> {
  const zip = new JSZip();

  for (const photo of photos) {
    zip.file(photo.finalName, photo.blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const partNumber = photos[0]?.finalName.split("_")[0] ?? "photos";
  const zipName = `${partNumber}_photos.zip`;

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Try sharing photos via Web Share API (additional fallback). */
export async function sharePhotos(
  photos: CapturedPhoto[]
): Promise<boolean> {
  const files = photos.map(
    (p) => new File([p.blob], p.finalName, { type: "image/jpeg" })
  );

  if (!navigator.canShare?.({ files })) {
    return false;
  }

  try {
    await navigator.share({ files });
    return true;
  } catch (err) {
    if ((err as DOMException).name === "AbortError") {
      return false; // User cancelled
    }
    throw err;
  }
}
