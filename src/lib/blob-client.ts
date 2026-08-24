import { getBlobUploadPermissions } from "../services/api-client";

/**
 * A second copy of every receiving photo, into Azure Blob — the warehouse.
 *
 * The photos already go to SharePoint and that does not change. What changes is
 * that a copy also lands somewhere Tork owns outright. SharePoint files are read
 * by signing in AS A PERSON, so only the receiver who took a photo can fetch it;
 * nothing else can, without an administrator granting a new permission. That is
 * not a theoretical problem — it has already blocked work that needed those
 * photos. Blob is read with Tork's own credentials.
 *
 * The upload goes from the phone straight to Azure. The proxy only hands out a
 * short-lived permission to write one named file; the photo itself never passes
 * through it.
 *
 * NOTHING HERE MAY INTERRUPT RECEIVING. Every failure is caught and returned as
 * a count. By the time this runs the receipt is in SAP and the photos are in
 * SharePoint, so a second copy is an improvement, never a requirement.
 */

export interface BlobUploadRequest {
  blobName: string;
  contentType: string;
  blob: Blob;
}

export interface BlobUploadResult {
  /** Files that reached Azure. */
  uploaded: string[];
  /** Files that did not, with the reason. Never thrown — receiving carries on. */
  failed: { blobName: string; error: string }[];
  /** Where they went, for the index cards. Null if nothing landed. */
  container: string | null;
}

/** Slower than SharePoint is fine. Hanging is not — the receiver is waiting. */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Three at a time, not twelve. Warehouse wifi is not fast, and a dozen
 * simultaneous eight-megabyte uploads starve each other into timing out. Small
 * batches finish sooner than a stampede does.
 */
const BATCH = 3;

export async function copyToBlob(
  files: BlobUploadRequest[],
  container?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<BlobUploadResult> {
  const result: BlobUploadResult = { uploaded: [], failed: [], container: null };
  if (files.length === 0) return result;

  const granted = await getBlobUploadPermissions(
    files.map((f) => ({ blobName: f.blobName, contentType: f.contentType })),
    container,
  );
  if (!granted) {
    return { ...result, failed: files.map((f) => ({ blobName: f.blobName, error: "no upload permission" })) };
  }

  for (const r of granted.refused) result.failed.push({ blobName: r.blobName, error: r.reason });
  result.container = granted.permissions[0]?.container ?? null;

  // The proxy cleans the names it is given, so a permission's name may differ
  // from what was asked for. Match on position among the files it did not
  // refuse, never on the name itself.
  const refusedNames = new Set(granted.refused.map((r) => r.blobName));
  const pending = files.filter((f) => !refusedNames.has(f.blobName));

  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (file, j) => {
        const permission = granted.permissions[i + j];
        if (!permission) {
          result.failed.push({ blobName: file.blobName, error: "no permission returned for this file" });
          return;
        }
        try {
          const res = await fetch(permission.url, {
            method: "PUT",
            headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": file.contentType },
            body: file.blob,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`Azure refused: ${res.status}`);
          result.uploaded.push(permission.blobName);
        } catch (err) {
          result.failed.push({ blobName: file.blobName, error: err instanceof Error ? err.message : String(err) });
        } finally {
          onProgress?.(++done, pending.length);
        }
      }),
    );
  }

  return result;
}
