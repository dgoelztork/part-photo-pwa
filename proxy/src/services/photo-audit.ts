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
  /**
   * PO numbers the receipt was raised against — the DocNum a person says out
   * loud and the key `file_cards.doc_reference` stores, NOT the DocEntry.
   *
   * A receipt line carries the PO's DocEntry, which is an internal key and a
   * different number entirely. Reporting that here made this alert impossible
   * to follow up: you could not look the receipt's photos up by it, and a
   * DocEntry read as a PO number silently points at the wrong order.
   */
  poNumbers: number[];
  /** The raw DocEntry values behind those numbers, for tracing in SAP. */
  poDocEntries: number[];
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
        poNumbers: [],
        poDocEntries: [
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

  await fillPoNumbers(missing);

  return { missing, checked, sinceDate: since };
}

/**
 * Turn each receipt's PO DocEntry values into the PO numbers people use.
 *
 * Only the receipts that are actually missing photos are resolved, which is
 * normally a handful, so this is one extra request rather than a second walk.
 * A failure here leaves poNumbers empty rather than throwing: an alert with no
 * PO number is still worth sending, and losing the whole audit to a lookup is
 * a worse trade than losing one field of it.
 */
async function fillPoNumbers(missing: MissingPhotoReceipt[]): Promise<void> {
  const entries = [...new Set(missing.flatMap((m) => m.poDocEntries))];
  if (entries.length === 0) return;

  const byEntry = new Map<number, number>();
  const CHUNK = 20;
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const filter = entries.slice(i, i + CHUNK).map((e) => `DocEntry eq ${e}`).join(" or ");
      const res = await slFetch(`/PurchaseOrders?$select=DocEntry,DocNum&$filter=${filter}`);
      if (!res.ok) return;
      for (const po of ((await res.json()) as Record<string, any>).value ?? []) {
        if (typeof po.DocEntry === "number" && typeof po.DocNum === "number") {
          byEntry.set(po.DocEntry, po.DocNum);
        }
      }
    }
  } catch {
    return;
  }

  for (const m of missing) {
    m.poNumbers = m.poDocEntries.map((e) => byEntry.get(e)).filter((n): n is number => typeof n === "number");
  }
}
