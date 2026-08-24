import { uploadFile, uploadFileToSharePoint, getSharePointFolderWebUrl } from "./graph-client";
import { saveFileCards, type FileCard } from "../services/api-client";
import { copyToBlob } from "./blob-client";
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
  /**
   * What this file actually is, kept as fields rather than only encoded into
   * the filename. Sent to the proxy after upload so every photo gets an index
   * card that can be searched and joined.
   */
  card: {
    kind: string;
    partNumber?: string | null;
    lineNum?: number | null;
    description?: string | null;
    /** When the photo was actually taken, not when it was uploaded. */
    capturedAt?: string | null;
  };
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

  const addGroup = (photos: SessionPhoto[], section: string, kind: string) => {
    photos.forEach((p, i) => {
      if (!p.blob || p.blob.size === 0) return; // skip stripped/persisted-empty blobs
      const idxSuffix = photos.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      entries.push({
        folder,
        blob: p.blob,
        filename: `${prefix}_${section}_${ts}${idxSuffix}.${extFor(p.blob)}`,
        contentType: mimeFor(p.blob),
        destination: "receiving",
        card: { kind, capturedAt: p.timestamp },
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
        card: { kind: "shipping-label", description: `Box ${bi + 1} shipping label`, capturedAt: p.timestamp },
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
        card: { kind: "damage", description: `Box ${bi + 1} damage`, capturedAt: p.timestamp },
      });
    });
  });
  addGroup(session.packingSlipPhotos, "PACKING_SLIP", "packing-slip");

  for (const doc of session.documents) {
    if (!doc.photo.blob || doc.photo.blob.size === 0) continue;
    entries.push({
      folder,
      blob: doc.photo.blob,
      filename: `${prefix}_DOC_${doc.documentType.toUpperCase()}_${ts}.${extFor(doc.photo.blob)}`,
      contentType: mimeFor(doc.photo.blob),
      destination: "receiving",
      card: {
        kind: `document-${String(doc.documentType).toLowerCase()}`,
        description: `${doc.documentType} supplied with the shipment`,
        capturedAt: doc.photo.timestamp,
      },
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
        card: {
          kind: "item",
          partNumber: line.itemCode,
          lineNum: line.lineNum,
          description: line.itemDescription ?? null,
          capturedAt: p.timestamp,
        },
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
        card: {
          kind: "item",
          partNumber: line.itemCode,
          lineNum: line.lineNum,
          description: line.itemDescription ?? null,
          capturedAt: p.timestamp,
        },
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
        card: {
          kind: "nameplate",
          partNumber: line.itemCode,
          lineNum: line.lineNum,
          description: line.itemDescription ?? null,
          capturedAt: p.timestamp,
        },
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
        card: {
          kind: "nameplate",
          partNumber: line.itemCode,
          lineNum: line.lineNum,
          description: line.itemDescription ?? null,
          capturedAt: p.timestamp,
        },
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
        card: {
          kind: "quantity",
          partNumber: line.itemCode,
          lineNum: line.lineNum,
          description: line.itemDescription ?? null,
          capturedAt: p.timestamp,
        },
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
  const landed: UploadEntry[] = [];
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
      landed.push(entry);
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

  // A second copy into Azure Blob — the warehouse Tork owns outright. SharePoint
  // stays the place the warehouse works from; this is the copy every other tool
  // can read, because a SharePoint file can only be fetched by signing in as a
  // person. Runs after SharePoint on purpose: the receiver's own need is met
  // first, and by now they have already moved on.
  let blobResult: Awaited<ReturnType<typeof copyToBlob>> = { uploaded: [], failed: [], container: null };
  if (landed.length > 0) {
    try {
      blobResult = await copyToBlob(
        landed.map((entry) => ({
          blobName: `${entry.folder}/${entry.filename}`,
          contentType: entry.contentType,
          blob: entry.blob,
        })),
        undefined,
        (done, total) => onProgress?.({ current: done, total, fileName: `warehouse copy ${done}/${total}` }),
      );
      if (blobResult.failed.length)
        console.warn(`[Blob] ${blobResult.uploaded.length} copied, ${blobResult.failed.length} not:`, blobResult.failed);
      else console.log(`[Blob] ${blobResult.uploaded.length} copied to the warehouse`);
    } catch (err) {
      console.warn("[Blob] Warehouse copy failed entirely; photos are in SharePoint regardless:", err);
    }
  }
  const copiedToBlob = new Set(blobResult.uploaded);

  let folderUrl: string | undefined;
  if (uploaded > 0) {
    try {
      folderUrl = await getSharePointFolderWebUrl(folder);
    } catch {
      // Best-effort — don't fail the upload if webUrl lookup hiccups.
    }
  }

  // Index card per file that actually landed. Best-effort and non-blocking: the
  // photos are already safe in SharePoint by this point and the receipt is
  // already in SAP, so nothing here may surface to the receiver. The whole block
  // is wrapped — building the list must not be able to throw into the upload
  // path either, not just the network call.
  try {
    const cards: FileCard[] = landed.map((entry) => ({
      container: entry.destination === "web-images" ? "sharepoint-webimages" : "sharepoint-receiving",
      blobName: `${entry.folder}/${entry.filename}`,
      originalName: entry.filename,
      contentType: entry.contentType,
      sizeBytes: entry.blob?.size ?? null,
      kind: entry.card?.kind ?? null,
      partNumber: entry.card?.partNumber ?? null,
      lineNum: entry.card?.lineNum ?? null,
      docReference: session.poNumber || null,
      description: entry.card?.description ?? null,
      storageUrl: entry.destination === "web-images" ? null : folderUrl ?? null,
      capturedAt: entry.card?.capturedAt ?? null,
      sourceApp: "receiving-app",
      // Which warehouse copy exists, if any. Deliberately left null when the
      // copy did not land, so a later job can tell what still needs backfilling
      // instead of assuming every photo is reachable.
      blobContainer: copiedToBlob.has(`${entry.folder}/${entry.filename}`) ? blobResult.container : null,
    }));
    // Awaited on purpose. It was fire-and-forget at first, which lost roughly
    // four receipts in nine: the receiver taps Done, the page goes to the
    // background, and an in-flight request is killed before it lands. This runs
    // inside a block the app is already waiting on to finish the uploads, so a
    // couple of seconds here costs the receiver nothing — they are already back
    // on the dashboard. The request is capped, and failure is still swallowed.
    const r = await saveFileCards(cards);
    if (r) console.log(`[FileCards] ${r.inserted} carded, ${r.duplicate} already known, ${r.failed} failed`);
  } catch (err) {
    console.warn("[FileCards] Could not record cards; photos are uploaded regardless:", err);
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
