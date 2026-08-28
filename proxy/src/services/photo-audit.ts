/**
 * Photo audit — finds receipts filed from the app whose photos never landed.
 *
 * The failure this catches is silent by construction. The receipt posts to
 * SAP, the app says "Submitted", and then the phone stops the page mid-upload
 * — so no error is raised anywhere, on any device or server. The only trace is
 * an empty `OPDN.U_GRPODocs` on a receipt that says it came from the PWA.
 *
 * That went unnoticed for two months: 64 of 173 app receipts between July and
 * August lost their photos, roughly one in three, and it surfaced only when a
 * receiver happened to count the files in SharePoint. Hence this.
 *
 * It reads SAP rather than any local record on purpose — SAP is the one place
 * that knows both that a receipt exists and whether its evidence arrived. A
 * client-side check can't see the receipts whose client died.
 */
import { slFetch, parseSLError } from "./sl-session.js";

export interface MissingPhotoReceipt {
  docNum: number;
  docEntry: number;
  docDate: string | null;
  /** Receiver the app stamped into U_GRPOdetails. */
  receivedBy: string | null;
  /** PO numbers the receipt was raised against, for context. */
  poNumbers: number[];
}

export interface PhotoAuditResult {
  /** Receipts from the app whose photo folder link is empty. */
  missing: MissingPhotoReceipt[];
  /** How many app receipts were examined. */
  checked: number;
  sinceDate: string;
}

/** SAP stamps this into U_GRPOdetails for every receipt the app posts. */
const PWA_MARKER = "Received via PWA";
const RECEIVER_RE = /\[Received via PWA by ([^\]]+)\]/;

/** Service Layer pages at 20 regardless of $top, so walk it. */
const PAGE = 20;
const MAX_PAGES = 15;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function auditRecentPhotos(days = 7): Promise<PhotoAuditResult> {
  const since = isoDaysAgo(days);
  const missing: MissingPhotoReceipt[] = [];
  let checked = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await slFetch(
      `/PurchaseDeliveryNotes?$filter=DocDate ge '${since}'` +
        `&$select=DocEntry,DocNum,DocDate,U_GRPODocs,U_GRPOdetails,DocumentLines` +
        `&$orderby=DocEntry desc&$top=${PAGE}&$skip=${page * PAGE}`
    );

    if (!res.ok) {
      const err = await parseSLError(res);
      throw new Error(`SAP lookup failed: ${err.message}`);
    }

    const rows = ((await res.json()) as Record<string, any>).value ?? [];
    if (rows.length === 0) break;

    for (const doc of rows) {
      const details = String(doc.U_GRPOdetails ?? "");
      // Receipts keyed in through SAP directly have no photos by definition —
      // only the app's own receipts are expected to carry evidence.
      if (!details.includes(PWA_MARKER)) continue;
      checked++;
      if (doc.U_GRPODocs) continue;

      missing.push({
        docNum: doc.DocNum,
        docEntry: doc.DocEntry,
        docDate: doc.DocDate ? String(doc.DocDate).slice(0, 10) : null,
        receivedBy: RECEIVER_RE.exec(details)?.[1] ?? null,
        poNumbers: [
          ...new Set(
            (doc.DocumentLines ?? [])
              .map((l: Record<string, any>) => l.BaseEntry)
              .filter((n: unknown): n is number => typeof n === "number")
          ),
        ] as number[],
      });
    }

    if (rows.length < PAGE) break;
  }

  return { missing, checked, sinceDate: since };
}
