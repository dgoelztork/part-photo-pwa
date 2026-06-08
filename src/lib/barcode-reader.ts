/**
 * Decode barcodes from a still photo of a shipping label.
 *
 * Strategy: shipping labels carry several barcodes — MaxiCode (UPS 2D),
 * routing/sortation 1Ds, the tracking 1D, sometimes ITF for shipper acct.
 * ZXing's single-result decoder returns whatever it locks onto first, which
 * may not be the tracking number we want.
 *
 * To find the tracking 1D specifically we try the full image first; if that
 * yields nothing matching a known carrier tracking format, we slice the
 * image into horizontal bands (tracking is usually in the bottom band on
 * UPS/FedEx labels) and try each. First classifying hit wins.
 *
 * Vision OCR still runs in parallel as the fallback (and for fields the
 * barcode doesn't carry: weight, ZIPs, service speed).
 */
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";

export interface BarcodeTrackingHit {
  trackingNumber: string;
  /** Inferred from the tracking format. Null if the format is ambiguous. */
  carrier: "UPS" | "FedEx" | "USPS" | "DHL" | null;
  /** Raw decoded text — kept for diagnostics. */
  rawText: string;
}

/** Carrier tracking number formats. Order matters: most specific first. */
const CARRIER_PATTERNS: Array<{
  carrier: BarcodeTrackingHit["carrier"];
  test: (s: string) => boolean;
}> = [
  // UPS: 1Z + 16 alphanumerics. Most distinctive.
  { carrier: "UPS", test: (s) => /^1Z[A-Z0-9]{16}$/.test(s) },
  // USPS IMpb: 20-22 digits, typically starts with 9.
  { carrier: "USPS", test: (s) => /^9\d{19,21}$/.test(s) },
  // FedEx: 12 or 15 digits, all numeric (no leading 9 — that's USPS).
  { carrier: "FedEx", test: (s) => /^[1-8]\d{11}$|^[1-8]\d{14}$/.test(s) },
  // DHL: 10-11 digits.
  { carrier: "DHL", test: (s) => /^\d{10,11}$/.test(s) },
  // FedEx Ground sometimes uses 20-22 digits with non-9 leading digit.
  { carrier: "FedEx", test: (s) => /^[1-8]\d{19,21}$/.test(s) },
];

function classifyTracking(text: string): BarcodeTrackingHit | null {
  // Code 128 sometimes embeds GS1 Application Identifiers or check digits;
  // strip non-alphanumerics so a barcode like "(420)94501" still matches.
  const stripped = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  for (const { carrier, test } of CARRIER_PATTERNS) {
    if (test(stripped)) {
      return { trackingNumber: stripped, carrier, rawText: text };
    }
  }
  return null;
}

function buildReader(): MultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
  ]);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

/** Turn RGBA ImageData into a BinaryBitmap suitable for ZXing. */
function bitmapFromImageData(imageData: ImageData): BinaryBitmap {
  const len = imageData.width * imageData.height;
  const argb = new Int32Array(len);
  const px = imageData.data;
  for (let i = 0; i < len; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    // Alpha forced to 0xFF — labels are opaque.
    argb[i] = (0xff << 24) | (r << 16) | (g << 8) | b;
  }
  const luminance = new RGBLuminanceSource(argb, imageData.width, imageData.height);
  return new BinaryBitmap(new HybridBinarizer(luminance));
}

function tryDecode(reader: MultiFormatReader, bitmap: BinaryBitmap): BarcodeTrackingHit | null {
  try {
    const result = reader.decode(bitmap);
    return classifyTracking(result.getText());
  } catch {
    return null;
  } finally {
    reader.reset();
  }
}

/** Slice an ImageData horizontally into y0..y1 (pixel rows). */
function sliceY(src: ImageData, y0: number, y1: number): ImageData {
  const h = y1 - y0;
  const w = src.width;
  const out = new ImageData(w, h);
  const offset = y0 * w * 4;
  out.data.set(src.data.subarray(offset, offset + w * h * 4));
  return out;
}

/**
 * Find a carrier-format tracking barcode in the image, returning null if
 * none of the regions we try yield a match.
 */
export async function decodeShippingLabelBarcode(
  blob: Blob,
): Promise<BarcodeTrackingHit | null> {
  let imageData: ImageData;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const reader = buildReader();
  const H = imageData.height;

  // Regions to try, in priority order. Full image first (fastest path); then
  // bands that target where tracking barcodes typically live on the label.
  const regions: Array<() => ImageData> = [
    () => imageData,
    () => sliceY(imageData, Math.floor(H * 0.55), H),         // bottom 45%
    () => sliceY(imageData, 0, Math.floor(H * 0.45)),         // top 45%
    () => sliceY(imageData, Math.floor(H * 0.30), Math.floor(H * 0.75)), // middle 45%
  ];

  for (const region of regions) {
    const hit = tryDecode(reader, bitmapFromImageData(region()));
    if (hit) return hit;
  }
  return null;
}
