/**
 * API client for the receiving proxy server.
 * Handles auth (Azure token → proxy JWT) and all SAP proxy calls.
 */

import { getAccessToken } from "../lib/auth";

const PROXY_URL_KEY = "proxy-url";
const DEFAULT_PROXY_URL = "https://tork-app.tail14e57a.ts.net:3001";

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
  shippingSpeed: string | null;
}

/** Send a shipping-label image to the proxy for OCR + structured extraction. */
export async function extractShippingLabel(
  image: Blob
): Promise<ShippingLabelExtraction> {
  const resized = await resizeForVision(image);
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

/** Downscale to <= 1500px on the long edge and re-encode as JPEG. Keeps requests under Anthropic's per-image limits and reduces vision token cost. */
async function resizeForVision(blob: Blob, maxDim = 1500): Promise<Blob> {
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
      0.85
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
