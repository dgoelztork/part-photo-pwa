import type { ReceivingSession } from "../types/session";
import { patchGrpoDocsUrl, reportUploadFailure } from "../services/api-client";
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

// ---- uploads the phone stopped ----------------------------------------------
//
// When iOS stops the page mid-upload (screen locked, app switched), no code
// runs to say so. So each upload leaves a note in localStorage as it starts,
// marks it if the page goes to the background, and removes it when it ends.
// A note still there on the next open is an upload that was cut off — reported
// then, with whether the page had been hidden. That is the question the server
// log could never answer.

const PENDING_KEY = "receiving.uploadsInProgress";

interface PendingUpload {
  docNum: number | null;
  poNumber: string;
  startedAt: number;
  hidden: boolean;
  trigger: string;
}

function readPending(): Record<string, PendingUpload> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePending(all: Record<string, PendingUpload>): void {
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch {
    // Best-effort: without storage we lose the cut-off report, nothing else.
  }
}

function updatePending(change: (p: Record<string, PendingUpload>) => void): void {
  const all = readPending();
  change(all);
  writePending(all);
}

/**
 * Report uploads the phone stopped since the app last ran. Call once on open,
 * before anything starts a new upload.
 */
export function reportCutOffUploads(): void {
  const all = readPending();
  for (const [id, p] of Object.entries(all)) {
    if (inFlight.has(id)) continue;
    reportUploadFailure({
      step: "cut-off",
      docNum: p.docNum,
      poNumber: p.poNumber,
      hidden: p.hidden,
      trigger: p.trigger,
      reason: "the app was stopped before the upload finished",
      secondsSinceStart: (Date.now() - p.startedAt) / 1000,
    });
    delete all[id];
  }
  writePending(all);
}

/**
 * Send a receipt's photos and stamp the folder URL on its GRPO.
 *
 * The one path for the first attempt, the "Upload the photos" button and the
 * automatic resend, so a retry behaves exactly like the original. It never
 * posts or changes a receipt beyond writing that folder link.
 *
 * `trigger` names the caller in failure reports: "submit", "button" or "auto".
 *
 * Returns null without doing anything when this session is already uploading.
 */
export async function sendSessionPhotos(
  session: ReceivingSession,
  docEntry: number | null,
  onProgress?: (p: UploadProgress) => void,
  trigger = "submit",
): Promise<SendPhotosResult | null> {
  if (inFlight.has(session.id)) return null;
  inFlight.add(session.id);

  const startedAt = Date.now();
  let hidden = false;
  const onVisibility = () => {
    if (document.visibilityState !== "hidden" || hidden) return;
    hidden = true;
    updatePending((all) => {
      if (all[session.id]) all[session.id].hidden = true;
    });
  };
  updatePending((all) => {
    all[session.id] = {
      docNum: session.grpoDocNum ?? null,
      poNumber: session.poNumber,
      startedAt,
      hidden: false,
      trigger,
    };
  });
  document.addEventListener("visibilitychange", onVisibility);

  const report = (step: "upload" | "folder-link", reason: string, sent?: number, total?: number) =>
    reportUploadFailure({
      step,
      docNum: session.grpoDocNum ?? null,
      poNumber: session.poNumber,
      sent,
      total,
      hidden,
      reason,
      trigger,
      secondsSinceStart: (Date.now() - startedAt) / 1000,
    });

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
        report("folder-link", err instanceof Error ? err.message : String(err));
      }
    } else if (docEntry !== null && outcome.uploaded > 0 && !outcome.folderUrl) {
      // The photos are in SharePoint but the folder's link couldn't be read,
      // so SAP gets no link — how GRPO 78134 ended up without one on 15 Oct.
      report("folder-link", "SharePoint did not return the folder link");
    }

    // Only a clean run counts. A partial upload leaves the phone holding the
    // only copy of what didn't make it.
    const recvFailed = outcome.failed.filter((f) => f.destination === "receiving");
    const clean = outcome.uploaded > 0 && recvFailed.length === 0;
    if (!clean) {
      report(
        "upload",
        recvFailed[0]?.error ?? "no photos were sent",
        outcome.uploaded,
        outcome.uploaded + recvFailed.length,
      );
    }
    return { outcome, clean };
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
    updatePending((all) => {
      delete all[session.id];
    });
    inFlight.delete(session.id);
  }
}
