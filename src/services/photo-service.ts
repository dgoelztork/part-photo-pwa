import type { CapturedPhoto } from "../types/session";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { transcribeDocument } from "./api-client";

/** Prompt native camera and return a File. */
export function capturePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Open the iOS file picker without forcing the camera, accepting both PDFs and images.
 * On iOS, "Choose Files" → "Scan Documents" returns a multi-page PDF from the native scanner.
 */
export function captureDocument(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png,image/heic,image/heif";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  });
}

/** Create a CapturedPhoto from a File. */
export function processCapture(file: File): CapturedPhoto {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    blob: file,
    thumbnailUrl: URL.createObjectURL(file),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Turn a captured document file into a CapturedPhoto whose `blob` is always a PDF.
 * - PDF input → used as-is (multi-page scans from the iOS native scanner). No
 *   in-PDF OCR layer added; SharePoint's auto-OCR will eventually index it.
 * - Image input → embedded as a single page, with an invisible OCR text layer
 *   from Claude Haiku 4.5 so the PDF is searchable in Acrobat / Preview /
 *   SharePoint immediately, without waiting on SharePoint's auto-OCR.
 *
 * If the OCR call fails (network, API outage, key missing), we fall back to a
 * non-searchable PDF instead of blocking the capture. Users always get a doc.
 */
export async function processDocumentCapture(file: File): Promise<CapturedPhoto> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const timestamp = new Date().toISOString();

  if (file.type === "application/pdf") {
    return { id, blob: file, thumbnailUrl: PDF_THUMB_PLACEHOLDER, timestamp };
  }

  // Run OCR + PDF-wrap in parallel so we don't double the user's wait time.
  const [ocrText, pdfBlob] = await Promise.all([
    transcribeDocument(file).catch((err) => {
      console.warn("[photo-service] OCR failed; PDF will not be text-searchable", err);
      return "";
    }),
    wrapImageInPdf(file),
  ]);

  const finalBlob = ocrText
    ? await addHiddenTextLayer(pdfBlob, ocrText).catch(() => pdfBlob)
    : pdfBlob;

  return { id, blob: finalBlob, thumbnailUrl: URL.createObjectURL(file), timestamp };
}

async function wrapImageInPdf(imageFile: File): Promise<Blob> {
  const bytes = new Uint8Array(await imageFile.arrayBuffer());
  const pdf = await PDFDocument.create();
  const isPng = imageFile.type === "image/png";
  // pdf-lib only natively supports JPEG and PNG. iOS HEIC photos coming through
  // <input type="file"> are converted to JPEG by Safari before reaching us.
  const embedded = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage([embedded.width, embedded.height]);
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  const pdfBytes = await pdf.save();
  // Copy to a fresh ArrayBuffer so TypeScript stops worrying about SAB types
  return new Blob([new Uint8Array(pdfBytes).buffer], { type: "application/pdf" });
}

/**
 * Re-open a single-page PDF and append the OCR transcription as an invisible
 * text layer on the page. The text isn't placed at word-level coordinates
 * (Claude vision doesn't return bounding boxes by default) — it's wrapped to
 * fit the page, with opacity 0 so it doesn't render. Search engines and PDF
 * viewers' Ctrl-F still find matches.
 */
async function addHiddenTextLayer(pdfBlob: Blob, text: string): Promise<Blob> {
  const pdf = await PDFDocument.load(await pdfBlob.arrayBuffer());
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // Strip non-ASCII characters that pdf-lib's default Helvetica can't encode
  // (e.g. smart quotes, em dashes, accented chars from foreign-language labels).
  // The visible image still shows the original; this layer is only for search.
  const safeText = text.replace(/[^\x20-\x7E\n\r\t]/g, "?");
  page.drawText(safeText, {
    x: 4,
    y: page.getHeight() - 12,
    size: 8,
    font,
    opacity: 0,
    lineHeight: 9,
    maxWidth: page.getWidth() - 8,
  });
  const out = await pdf.save();
  return new Blob([new Uint8Array(out).buffer], { type: "application/pdf" });
}

// Inline SVG data URL — small, no asset to ship, good enough as a placeholder thumbnail.
const PDF_THUMB_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="8" fill="#f3f4f6"/>' +
      '<text x="40" y="46" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#6b7280">PDF</text>' +
      "</svg>"
  );

/** Revoke all thumbnail URLs to free memory. */
export function revokePhotos(photos: CapturedPhoto[]): void {
  for (const photo of photos) {
    if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
  }
}
