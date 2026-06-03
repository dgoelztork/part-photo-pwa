/**
 * Decode barcodes from a still photo of a shipping label.
 *
 * Strategy: try @zxing/browser's BrowserMultiFormatReader on the captured
 * blob. If it finds a Code 128 (or other 1D) barcode whose contents match
 * a known carrier tracking format, return that — it's drastically more
 * accurate than vision OCR for tracking numbers, especially when the
 * label is wet, dirty, smudged, or at an angle. Vision OCR still runs
 * in parallel and supplies the fields the barcode doesn't carry (weight,
 * ZIPs, service speed).
 *
 * Limitations:
 *   - We decode a single best result per scan, not every barcode on the
 *     label. Good enough for tracking; would need a multi-decode pass to
 *     read MaxiCode/PDF417 for ZIP/service code (rarely worth it).
 *   - If the dominant barcode on the image isn't the tracking number
 *     (e.g., a small routing/sortation code is closer to center), we may
 *     decode it and fail the tracking-format match. In that case we fall
 *     back to OCR for tracking — no worse than today.
 */
import { BrowserMultiFormatReader } from "@zxing/browser";

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

/**
 * Decode a barcode from the given image blob and, if it matches a known
 * carrier tracking format, return the tracking info. Returns null if
 * nothing usable was found.
 */
export async function decodeShippingLabelBarcode(
  blob: Blob,
): Promise<BarcodeTrackingHit | null> {
  const url = URL.createObjectURL(blob);
  try {
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(url);
    return classifyTracking(result.getText());
  } catch {
    // ZXing throws NotFoundException when no barcode is decoded. That's
    // expected often (small label, blur, no in-frame barcode). Swallow.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
