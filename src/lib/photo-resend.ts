import type { ReceivingSession } from "../types/session";
import { patchGrpoDocsUrl } from "../services/api-client";
import {
  uploadReceivingSessionToSharePoint,
  type ReceivingUploadResult,
  type UploadProgress,
} from "./file-exporter";

/**
 * Does this session still hold the photo bytes?
 *
 * Receipts submitted before photos were persisted come back with empty blobs,
 * and so do ones whose upload is confirmed done. Offering "upload the photos"
 * when there is nothing left to send would be a button that can only fail.
 */
export function hasPhotoBytes(session: ReceivingSession): boolean {
  const any = (photos: { blob: Blob }[]) => photos.some((p) => p.blob && p.blob.size > 0);
  return (
    session.boxes.some((b) => any(b.labelPhotos) || any(b.damagePhotos)) ||
    any(session.packingSlipPhotos) ||
    session.documents.some((d) => d.photo.blob && d.photo.blob.size > 0) ||
    session.lineItems.some(
      (l) => any(l.photos) || any(l.nameplatePhotos) || any(l.quantityPhotos)
    )
  );
}

/**
 * A submitted receipt whose photos never landed and are still on this phone.
 *
 * The store only stops carrying the bytes once an upload is confirmed clean,
 * so a submitted session that still has them is exactly one that needs sending.
 */
export function needsPhotoResend(session: ReceivingSession): boolean {
  return session.status === "SUBMITTED" && session.photosUploaded !== true && hasPhotoBytes(session);
}

export interface SendPhotosResult {
  outcome: ReceivingUploadResult | null;
  /** Every receiving photo landed. Only a clean run lets the phone drop the bytes. */
  clean: boolean;
}

/**
 * Sessions with an upload under way, across every caller. The submit screen and
 * the dashboard's automatic resend can both reach for the same receipt — the
 * receiver tapping back to the dashboard mid-upload is enough — and two uploads
 * of one receipt race each other into SharePoint.
 */
const inFlight = new Set<string>();

/**
 * Send a receipt's photos and stamp the folder URL on its GRPO.
 *
 * The one path for the first attempt, the "Upload the photos" button and the
 * automatic resend, so a retry behaves exactly like the original. It never
 * posts or changes a receipt beyond writing that folder link.
 *
 * Returns null without doing anything when this session is already uploading.
 */
export async function sendSessionPhotos(
  session: ReceivingSession,
  docEntry: number | null,
  onProgress?: (p: UploadProgress) => void,
): Promise<SendPhotosResult | null> {
  if (inFlight.has(session.id)) return null;
  inFlight.add(session.id);
  try {
    let outcome: ReceivingUploadResult | null = null;
    try {
      outcome = await uploadReceivingSessionToSharePoint(session, onProgress);
    } catch (err) {
      outcome = {
        uploaded: 0,
        webImagesUploaded: 0,
        failed: [{
          filename: "(upload aborted)",
          error: err instanceof Error ? err.message : String(err),
          destination: "receiving",
        }],
        folder: "",
      };
    }

    if (docEntry !== null && outcome.folderUrl && outcome.uploaded > 0) {
      try {
        await patchGrpoDocsUrl(docEntry, outcome.folderUrl);
      } catch (err) {
        console.warn("[PhotoResend] Failed to stamp U_GRPODocs:", err);
      }
    }

    // Only a clean run counts. A partial upload leaves the phone holding the
    // only copy of what didn't make it.
    const clean =
      outcome.uploaded > 0 &&
      outcome.failed.filter((f) => f.destination === "receiving").length === 0;
    return { outcome, clean };
  } finally {
    inFlight.delete(session.id);
  }
}
