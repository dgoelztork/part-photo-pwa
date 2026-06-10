import { uploadFile, uploadFileToSharePoint, getSharePointFolderWebUrl } from "./graph-client";
import { RECEIVING_SHAREPOINT_PATH, WEB_IMAGES_SHAREPOINT_PATH } from "../config";
import type { CapturedPhoto } from "../types";
import type { ReceivingSession, CapturedPhoto as SessionPhoto } from "../types/session";
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

// ---- Receiving session SharePoint upload ----

interface UploadEntry {
  folder: string;
  blob: Blob;
  filename: string;
  contentType: string;
  /** Graph DriveItem conflict behavior. Defaults to "replace" (overwrite). */
  conflictBehavior?: "replace" | "rename" | "fail";
  /** Tag identifying which destination this entry belongs to (for result accounting). */
  destination: "receiving" | "web-images";
}

/** Format a Date as `YYYY-MM-DD_HH-MM-SS` (filename-safe, no colons or slashes). */
function fmtTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Build the (folder, files[]) plan for a receiving session at a given timestamp. */
function buildUploadPlan(
  session: ReceivingSession,
  uploadedAt: Date
): { folder: string; entries: UploadEntry[] } {
  const ts = fmtTimestamp(uploadedAt);
  const po = session.poNumber || "NOPO";
  const folder = `${RECEIVING_SHAREPOINT_PATH}/PO${po} - ${ts.replace("_", " ")}`;

  const entries: UploadEntry[] = [];
  const prefix = `PO${po}`;

  // Per-blob extension/MIME — any section can carry PDFs (packing slip, documents) or
  // JPEGs (box, shipping label, line photos). Detect from blob type, not section.
  const extFor = (blob: Blob) => (blob.type === "application/pdf" ? "pdf" : "jpg");
  const mimeFor = (blob: Blob) =>
    blob.type === "application/pdf" ? "application/pdf" : "image/jpeg";

  const addGroup = (photos: SessionPhoto[], section: string) => {
    photos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return; // skip stripped/persisted-empty blobs
      const idxSuffix = photos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      entries.push({
        folder,
        blob: p.blob,
        filename: `${prefix}_${section}_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
      });
    });
  };

  // Shipping labels + any damage photos — both indexed per physical box so
  // each file's origin box is obvious in the receiving folder.
  session.boxes.forEach((b, bi) => {
    const boxTag = `BOX${String(bi + 1).padStart(2, "0")}`;
    b.labelPhotos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return;
      const idxSuffix = b.labelPhotos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      entries.push({
        folder,
        blob: p.blob,
        filename: `${prefix}_SHIPPING_LABEL_${boxTag}_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
      });
    });
    b.damagePhotos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return;
      const idxSuffix = b.damagePhotos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      entries.push({
        folder,
        blob: p.blob,
        filename: `${prefix}_${boxTag}_DAMAGE_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
      });
    });
  });
  addGroup(session.packingSlipPhotos, "PACKING_SLIP");

  for (const doc of session.documents) {
    if (!doc.photo.blob || doc.photo.blob.size === 0) continue;
    entries.push({
      folder,
      blob: doc.photo.blob,
      filename: `${prefix}_DOC_${doc.documentType.toUpperCase()}_${ts}.${extFor(doc.photo.blob)}`,
      contentType: mimeFor(doc.photo.blob),
      destination: "receiving",
    });
  }

  for (const line of session.lineItems) {
    const safeItem = line.itemCode.replace(/[^A-Za-z0-9_-]/g, "");
    const linePrefix = `${prefix}_LINE_${String(line.lineNum).padStart(3, "0")}_${safeItem}`;

    line.photos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return;
      const idxSuffix = line.photos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";

      // Primary copy — into the per-PO receiving folder.
      entries.push({
        folder,
        blob: p.blob,
        filename: `${linePrefix}_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
      });

      // Second copy — flat folder named by part number, for marketing/web use.
      // Use Graph "rename" so older shots of the same part aren't clobbered;
      // duplicates land as "M106412 1.jpg", "M106412 2.jpg" automatically.
      entries.push({
        folder: WEB_IMAGES_SHAREPOINT_PATH,
        blob: p.blob,
        filename: `${safeItem}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        conflictBehavior: "rename",
        destination: "web-images",
      });
    });

    // Nameplate / label / stamp photos — receiving folder + Web images second copy.
    line.nameplatePhotos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return;
      const idxSuffix = line.nameplatePhotos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      entries.push({
        folder,
        blob: p.blob,
        filename: `${linePrefix}_NAMEPLATE_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
      });

      // Web images second copy — suffix _nameplate so it's distinguishable from
      // the product shot. "rename" so older shots aren't clobbered.
      entries.push({
        folder: WEB_IMAGES_SHAREPOINT_PATH,
        blob: p.blob,
        filename: `${safeItem}_nameplate${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        conflictBehavior: "rename",
        destination: "web-images",
      });
    });

    // Full-quantity photos — receiving folder only, no marketing copy.
    line.quantityPhotos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return;
      const idxSuffix = line.quantityPhotos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      entries.push({
        folder,
        blob: p.blob,
        filename: `${linePrefix}_QTY_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
      });
    });
  }

  return { folder, entries };
}

export interface ReceivingUploadResult {
  /** Files written to the per-PO receiving folder. */
  uploaded: number;
  /** Files written to the per-part web-images folder (second copy of line photos only). */
  webImagesUploaded: number;
  failed: { filename: string; error: string; destination: "receiving" | "web-images" }[];
  folder: string;
  /** Clickable SharePoint URL for the receiving folder (resolved post-upload). */
  folderUrl?: string;
}

/** Upload all photos in a receiving session to SharePoint, organized by PO + datetime.
 *  Line photos additionally land in a flat per-part folder for marketing/web use. */
export async function uploadReceivingSessionToSharePoint(
  session: ReceivingSession,
  onProgress?: (progress: UploadProgress) => void
): Promise<ReceivingUploadResult> {
  const { folder, entries } = buildUploadPlan(session, new Date());
  const failed: ReceivingUploadResult["failed"] = [];
  let uploaded = 0;
  let webImagesUploaded = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress?.({ current: i + 1, total: entries.length, fileName: entry.filename });
    try {
      await uploadFileToSharePoint(
        entry.folder,
        entry.filename,
        entry.blob,
        entry.contentType,
        entry.conflictBehavior ?? "replace",
      );
      if (entry.destination === "web-images") webImagesUploaded++;
      else uploaded++;
    } catch (err) {
      failed.push({
        filename: entry.filename,
        error: err instanceof Error ? err.message : String(err),
        destination: entry.destination,
      });
    }
  }

  let folderUrl: string | undefined;
  if (uploaded > 0) {
    try {
      folderUrl = await getSharePointFolderWebUrl(folder);
    } catch {
      // Best-effort — don't fail the upload if webUrl lookup hiccups.
    }
  }

  return { uploaded, webImagesUploaded, failed, folder, folderUrl };
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
