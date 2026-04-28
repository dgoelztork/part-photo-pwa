import type { CapturedPhoto } from "../types/session";
import { PDFDocument } from "pdf-lib";

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
 * - PDF input → used as-is.
 * - Image input → embedded as a single page in a fresh PDF (preserves aspect ratio).
 * The thumbnail uses the original image (or a small first-page render for PDFs would
 * require PDF.js — for now, scanned PDFs get a placeholder thumbnail).
 */
export async function processDocumentCapture(file: File): Promise<CapturedPhoto> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const timestamp = new Date().toISOString();

  if (file.type === "application/pdf") {
    return { id, blob: file, thumbnailUrl: PDF_THUMB_PLACEHOLDER, timestamp };
  }

  const pdfBlob = await wrapImageInPdf(file);
  return { id, blob: pdfBlob, thumbnailUrl: URL.createObjectURL(file), timestamp };
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
