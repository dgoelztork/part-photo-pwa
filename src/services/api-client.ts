/**
 * API client for the receiving proxy server.
 * Handles auth (Azure token → proxy JWT) and all SAP proxy calls.
 */

import { getAccessToken } from "../lib/auth";

const PROXY_URL_KEY = "proxy-url";
export const DEFAULT_PROXY_URL = "https://tork-app.tail14e57a.ts.net:3001";

let proxyJwt: string | null = null;

export function getProxyUrl(): string {
  return localStorage.getItem(PROXY_URL_KEY) ?? DEFAULT_PROXY_URL;
}

export function setProxyUrl(url: string): void {
  localStorage.setItem(PROXY_URL_KEY, url);
  proxyJwt = null; // Force re-auth on URL change
}

/** Authenticate with the proxy using the Azure AD token. */
async function authenticate(): Promise<string> {
  const azureToken = await getAccessToken();
  const res = await fetch(`${getProxyUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ azureToken }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Auth failed" }));
    throw new Error(err.message ?? `Proxy auth failed (${res.status})`);
  }

  const data = await res.json();
  proxyJwt = data.jwt;
  return data.jwt;
}

/** Get a valid proxy JWT, authenticating if needed. */
async function getJwt(): Promise<string> {
  if (proxyJwt) return proxyJwt;
  return authenticate();
}

/** Make an authenticated request to the proxy. Re-auths on 401. */
async function proxyFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  let jwt = await getJwt();

  const doRequest = (token: string) =>
    fetch(`${getProxyUrl()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

  let res = await doRequest(jwt);

  if (res.status === 401) {
    proxyJwt = null;
    jwt = await authenticate();
    res = await doRequest(jwt);
  }

  return res;
}

// --- API methods ---

export interface POResult {
  docEntry: number;
  docNum: number;
  vendorCode: string;
  vendorName: string;
  orderDate: string;
  // PO header notes (OPOR.U_pImportantInfo / U_pInternalComments / U_exponotes)
  importantInfo: string;
  internalComments: string;
  expoNotes: string;
  // Shipping detail defaults from PO header
  transpCode: string | null;
  shipSpeed: string;
  fob: string;
  frtChargeType: string;
  frtTracking: string;
  lines: POLine[];
  totalLines: number;
  openLineCount: number;
}

export interface POLine {
  lineNum: number;
  itemCode: string;
  itemDescription: string;
  orderedQty: number;
  openQty: number;
  unitPrice: number;
  warehouse: string;
  uom: string;
  // POR1.FreeTxt — line-specific note from the PO
  freeText: string;
}

export interface GRPOResult {
  docEntry: number;
  docNum: number;
}

/** Look up a Purchase Order by DocNum. */
export async function lookupPO(poNumber: string): Promise<POResult> {
  const res = await proxyFetch(`/api/po/${encodeURIComponent(poNumber)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "PO lookup failed" }));
    throw new Error(err.message ?? `PO lookup failed (${res.status})`);
  }
  return res.json();
}

/** Post a Goods Receipt PO. */
export async function postGRPO(payload: {
  vendorCode: string;
  poDocEntry: number;
  lines: Array<{
    baseEntry: number;
    baseLine: number;
    itemCode: string;
    quantity: number;
    warehouse: string;
  }>;
  comments?: string;
  /**
   * Catch-all dump of fields collected by the PWA that don't have a dedicated
   * SAP destination today. Lands in OPDN.U_GRPOdetails.
   */
  grpoDetails?: string;
  /** Tracking number — lands in OPDN.U_pFrtTracking. */
  frtTracking?: string;
  /** UPS-rated freight cost as a number (no $). Lands in OPDN.U_InboundFrt. */
  inboundFrt?: number;
}): Promise<GRPOResult> {
  const res = await proxyFetch("/api/grpo", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "GRPO posting failed" }));
    throw new Error(err.message ?? `GRPO posting failed (${res.status})`);
  }
  return res.json();
}

/**
 * Patch a posted GRPO with the SharePoint folder URL for photo evidence.
 * Lands in OPDN.U_GRPODocs. Best-effort — caller should swallow failures so
 * a SharePoint upload hiccup doesn't block the receiver from finishing.
 */
export async function patchGrpoDocsUrl(
  docEntry: number,
  sharePointUrl: string
): Promise<void> {
  const res = await proxyFetch(`/api/grpo/${docEntry}`, {
    method: "PATCH",
    body: JSON.stringify({ sharePointUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "GRPO patch failed" }));
    throw new Error(err.message ?? `GRPO patch failed (${res.status})`);
  }
}

export interface PicklistWarehouseStock {
  warehouse: string;
  inStock: number;
  committed: number;
  ordered: number;
}

export interface PicklistLine {
  lineNum: number;
  customerLineNo: string;
  itemCode: string;
  itemDescription: string;
  orderedQty: number;
  openQty: number;
  warehouse: string;
  uom: string;
  closed: boolean;
  pickStatus: string;
  pickedQty: number;
  poTargetNum: number | null;
  /** True when this SO line was ordered on the PO that was just received. */
  fromThisPo: boolean;
  /** Live on-hand across all warehouses. null when the stock lookup failed. */
  onHandTotal: number | null;
  onHandAtWarehouse: number | null;
  stockByWarehouse: PicklistWarehouseStock[];
  freeText: string;
  serial: string;
  tag: string;
  condition: string;
  customerPartNo: string;
}

export interface PicklistResult {
  poNumber: number;
  poDocEntry: number;
  vendorName: string;
  soNumber: number;
  soDocEntry: number;
  customerCode: string;
  customerName: string;
  customerPO: string;
  shipToCode: string;
  shipToAddress: string;
  vesselJob: string;
  soComments: string;
  orderDate: string | null;
  dueDate: string | null;
  soStatus: string;
  lines: PicklistLine[];
  openLineCount: number;
  closedLineCount: number;
  generatedAt: string;
}

/** Error thrown when a PO has no sales order to build a picklist from. */
export class NoSalesOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoSalesOrderError";
  }
}

/**
 * Build the pick sheet for the sales order behind a PO (OPOR.U_pSONumber).
 * Stock figures are read live, so calling this after the GRPO posts reflects
 * the receipt.
 */
export async function fetchPicklist(poNumber: string): Promise<PicklistResult> {
  const res = await proxyFetch(`/api/picklist/${encodeURIComponent(poNumber)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Picklist lookup failed" }));
    if (err.error === "NO_SO_LINKED" || err.error === "SO_REF_NOT_NUMERIC") {
      throw new NoSalesOrderError(err.message ?? "No sales order linked to this PO");
    }
    throw new Error(err.message ?? `Picklist lookup failed (${res.status})`);
  }
  return res.json();
}

export interface LabelPrinter {
  id: string;
  name: string;
  /** SAP warehouse codes this printer serves. */
  warehouses: string[];
}

export interface LabelSOLine {
  lineNum: number;
  customerLineNo: string;
  itemCode: string;
  itemDescription: string;
  orderedQty: number;
  openQty: number;
  warehouse: string;
  uom: string;
  closed: boolean;
  customerPartNo: string;
  freeText: string;
}

export interface LabelSalesOrder {
  soNumber: number;
  soDocEntry: number;
  customerCode: string;
  customerName: string;
  customerPO: string;
  shipToCode: string;
  vesselJob: string;
  orderDate: string | null;
  dueDate: string | null;
  soStatus: string;
  lines: LabelSOLine[];
}

export interface PrintLabelInput {
  itemCode: string;
  itemDescription: string;
  orderedQty?: number | null;
  soNumber?: number | string | null;
  customerName?: string | null;
  customerPartNo?: string | null;
  warehouse?: string | null;
  copies: number;
  printerId?: string;
}

export interface PrintLabelResult {
  sent: boolean;
  copies: number;
  printerId: string;
  printerName: string;
  itemCode: string;
}

/** Thrown when no printer serves the line's site, so nothing was printed. */
export class NoPrinterError extends Error {
  readonly printers: LabelPrinter[];
  constructor(message: string, printers: LabelPrinter[]) {
    super(message);
    this.name = "NoPrinterError";
    this.printers = printers;
  }
}

/** Label printers configured on the proxy. */
export async function fetchPrinters(): Promise<LabelPrinter[]> {
  const res = await proxyFetch("/api/labels/printers");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Printer lookup failed" }));
    throw new Error(err.message ?? `Printer lookup failed (${res.status})`);
  }
  const data = await res.json();
  return data.printers ?? [];
}

/** Look up a sales order and its lines for label printing. */
export async function lookupSalesOrder(soNumber: string): Promise<LabelSalesOrder> {
  const res = await proxyFetch(`/api/labels/sales-order/${encodeURIComponent(soNumber)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Sales order lookup failed" }));
    throw new Error(err.message ?? `Sales order lookup failed (${res.status})`);
  }
  return res.json();
}

/**
 * Send item labels to the site printer. Resolving means the printer accepted
 * the bytes — not that a label physically came out.
 */
export async function printItemLabels(input: PrintLabelInput): Promise<PrintLabelResult> {
  const res = await proxyFetch("/api/labels/print", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Print failed" }));
    if (err.error === "NO_PRINTER_FOR_WAREHOUSE" || err.error === "NO_PRINTERS_CONFIGURED") {
      throw new NoPrinterError(err.message ?? "No printer available", err.printers ?? []);
    }
    throw new Error(err.message ?? `Print failed (${res.status})`);
  }
  return res.json();
}

export type FeedbackKind = "bug" | "idea";

export interface FeedbackResult {
  id: number;
  kind: string;
  title: string;
  status: string;
  createdAt: string | null;
}

/**
 * File a bug or idea. Lands on the same board the Scupper feedback goes to,
 * tagged so it's clear it came from Receiving.
 */
export async function submitFeedback(input: {
  kind: FeedbackKind;
  title: string;
  body?: string;
  page?: string;
  /** Optional photo as a data URL. */
  photo?: string | null;
}): Promise<FeedbackResult> {
  const res = await proxyFetch("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not send feedback" }));
    throw new Error(err.message ?? `Could not send feedback (${res.status})`);
  }
  return res.json();
}

/**
 * Shrink a camera photo and encode it for feedback. Reuses the same resize
 * path as the vision calls so a full-resolution phone shot doesn't travel as
 * a multi-megabyte data URL.
 */
export async function photoToDataUrl(blob: Blob): Promise<string> {
  const resized = await resizeForVision(blob, 1280);
  return blobToDataUrl(resized);
}

/** Check if the proxy is reachable. */
export async function checkProxyHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getProxyUrl()}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ShippingLabelExtraction {
  carrier: string | null;
  trackingNumber: string | null;
  weight: string | null;
  shipFrom: string | null;
  shipToZip: string | null;
  shippingSpeed: string | null;
}

export interface UpsRateResult {
  serviceCode: string;
  serviceName: string;
  currency: string;
  listAmount: number;
  negotiatedAmount: number | null;
  billingWeightLbs: number | null;
}

/**
 * Thrown when the shipping speed can't be resolved to a UPS service, so no
 * rate was requested. Distinct from a failure: there's nothing to retry, the
 * receiver just needs to enter the freight (or a recognisable speed) by hand.
 */
export class UnknownShippingSpeedError extends Error {
  /** The unresolved speed, or "" when none was present at all. */
  readonly speed: string;
  constructor(message: string, speed: string) {
    super(message);
    this.name = "UnknownShippingSpeedError";
    this.speed = speed;
  }
}

/**
 * Look up a UPS parcel rate. Returns null if rating is not configured on the
 * proxy (503) — callers should treat this as "rate unavailable" and skip.
 * Throws UnknownShippingSpeedError when the speed isn't a recognised service,
 * and Error on validation problems or upstream UPS failures.
 */
export async function getUpsRate(input: {
  originZip: string;
  destZip: string;
  weight: string;
  shippingSpeed?: string;
}): Promise<UpsRateResult | null> {
  const res = await proxyFetch("/api/freight/ups-rate", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 503) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Rate lookup failed" }));
    if (err.error === "SPEED_NOT_RECOGNIZED" || err.error === "SPEED_MISSING") {
      throw new UnknownShippingSpeedError(
        err.message ?? "Shipping speed not recognised",
        typeof err.speed === "string" ? err.speed : ""
      );
    }
    throw new Error(err.message ?? `Rate lookup failed (${res.status})`);
  }
  return res.json();
}

/** Send a shipping-label image to the proxy for OCR + structured extraction. */
export async function extractShippingLabel(
  image: Blob
): Promise<ShippingLabelExtraction> {
  // Labels carry small print (ZIP codes, weight, service line) — keep more
  // pixels for vision OCR than we'd use for free-form documents.
  const resized = await resizeForVision(image, 1800);
  const dataUrl = await blobToDataUrl(resized);
  const res = await proxyFetch("/api/extract/shipping-label", {
    method: "POST",
    body: JSON.stringify({ image: dataUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Extraction failed" }));
    throw new Error(err.message ?? `Extraction failed (${res.status})`);
  }
  return res.json();
}

/**
 * Send a document image to the proxy for full-text OCR transcription.
 * Returns the visible text in the image as a single string. Used to add a
 * hidden, searchable text layer to the PDF before upload.
 */
export async function transcribeDocument(image: Blob): Promise<string> {
  const resized = await resizeForVision(image);
  const dataUrl = await blobToDataUrl(resized);
  const res = await proxyFetch("/api/extract/document-text", {
    method: "POST",
    body: JSON.stringify({ image: dataUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Transcription failed" }));
    throw new Error(err.message ?? `Transcription failed (${res.status})`);
  }
  const data = await res.json();
  return typeof data.text === "string" ? data.text : "";
}

/** Downscale to <= maxDim px on the long edge and re-encode as JPEG. Default 1024 is fine for free-form document OCR; callers pass higher (e.g. 1800) when small print (ZIPs, weight, tracking) matters. */
async function resizeForVision(blob: Blob, maxDim = 1024): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
      "image/jpeg",
      0.75
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---- File cards (the searchable index of captured evidence) ----

export interface FileCard {
  /** Which store the file lives in, e.g. "sharepoint-receiving". */
  container: string;
  /** Path within that store. Unique together with container. */
  blobName: string;
  originalName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  kind?: string | null;
  partNumber?: string | null;
  lineNum?: number | null;
  /** SAP document this evidence belongs to — the PO number for a receipt. */
  docReference?: string | null;
  description?: string | null;
  storageUrl?: string | null;
  capturedAt?: string | null;
  sourceApp?: string | null;
  /**
   * The Azure container holding a second copy, or null if there isn't one.
   * SharePoint files can only be fetched by signing in as the person who put
   * them there; this says whether the file is also somewhere any Tork tool can
   * read. Null means it still needs copying across.
   */
  blobContainer?: string | null;
  /**
   * SHA-256 of the file's bytes, lowercase hex. Lets the same picture be
   * recognised twice — a retried upload, or the same nameplate photographed on
   * two receipts. Null when it could not be taken; the file is stored anyway.
   */
  sha256?: string | null;
}

export interface SaveFileCardsResult {
  inserted: number;
  duplicate: number;
  failed: number;
}

/**
 * Record one index card per captured file.
 *
 * Deliberately best-effort: the photos are already safely uploaded by the time
 * this runs, so a failure here must never surface to the receiver or block a
 * receipt. Callers should not await this on the critical path.
 */
export async function saveFileCards(cards: FileCard[]): Promise<SaveFileCardsResult | null> {
  if (cards.length === 0) return { inserted: 0, duplicate: 0, failed: 0 };
  try {
    // Capped so a hung request can never hold up the upload block it now runs
    // inside. Typical write is under three seconds.
    const res = await proxyFetch("/api/file-cards", {
      method: "POST",
      body: JSON.stringify({ cards }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[FileCards] Proxy returned ${res.status}; photos are uploaded, cards are not.`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn("[FileCards] Could not record cards:", err);
    return null;
  }
}

// --- Azure Blob: the warehouse ------------------------------------------------

export interface BlobUploadPermission {
  url: string;
  blobName: string;
  container: string;
  expiresAt: string;
}

export interface BlobPermissionsResult {
  permissions: BlobUploadPermission[];
  refused: { blobName: string; reason: string }[];
}

/**
 * Ask the proxy for permission to write these files straight to Azure.
 *
 * The photos themselves never pass through the proxy — a receiving session is a
 * dozen files of several megabytes each, and routing that through the server
 * would slow the receiver down for no benefit. Each permission is write-only,
 * covers one named file, and lasts fifteen minutes.
 *
 * Returns null on any failure. The blob copy is an improvement over SharePoint,
 * never a requirement, so nothing here may interrupt a receipt.
 */
export async function getBlobUploadPermissions(
  files: { blobName: string; contentType: string }[],
  container?: string,
): Promise<BlobPermissionsResult | null> {
  if (files.length === 0) return { permissions: [], refused: [] };
  try {
    const res = await proxyFetch("/api/blob/upload-permissions", {
      method: "POST",
      body: JSON.stringify({ container, files }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[Blob] Proxy returned ${res.status}; photos are in SharePoint, no second copy.`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn("[Blob] Could not get upload permissions:", err);
    return null;
  }
}
