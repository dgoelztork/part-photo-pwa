import { Router } from "express";
import {
  extractShippingLabel,
  isVisionConfigured,
  transcribeDocument,
} from "../services/anthropic-vision.js";

const router = Router();

function parseImageDataUrl(input: unknown):
  | { ok: true; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }
  | { ok: false; status: number; body: { error: string; message: string } } {
  if (typeof input !== "string" || !input.startsWith("data:image/")) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "INVALID_IMAGE",
        message: "Body must include image as a data URL: 'data:image/jpeg;base64,...'",
      },
    };
  }
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(input);
  if (!match) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "INVALID_IMAGE",
        message: "Image must be JPEG, PNG, WebP, or GIF as a base64 data URL",
      },
    };
  }
  return {
    ok: true,
    mediaType: match[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
    data: match[2],
  };
}

/**
 * POST /api/extract/shipping-label
 * Body: { image: "data:image/jpeg;base64,..." }  (data-URL form, any image type Claude supports)
 * Returns: { carrier, trackingNumber, weight, shipFrom } — any field may be null.
 */
router.post("/shipping-label", async (req, res) => {
  if (!isVisionConfigured()) {
    res.status(503).json({
      error: "VISION_UNAVAILABLE",
      message: "ANTHROPIC_API_KEY not configured on the proxy",
    });
    return;
  }

  const parsed = parseImageDataUrl(req.body?.image);
  if (!parsed.ok) {
    res.status(parsed.status).json(parsed.body);
    return;
  }

  const user = (req as any).user as { email?: string } | undefined;
  const sizeKb = Math.round((parsed.data.length * 3) / 4 / 1024);
  const t0 = Date.now();
  try {
    const result = await extractShippingLabel(parsed.data, parsed.mediaType);
    const ms = Date.now() - t0;
    console.log(
      `[Extract] Shipping label for ${user?.email ?? "unknown"} ` +
        `(${sizeKb}KB image, ${ms}ms): ` +
        `carrier=${result.carrier ?? "-"}, tracking=${result.trackingNumber ?? "-"}, ` +
        `speed=${result.shippingSpeed ?? "-"}, weight=${result.weight ?? "-"}, zip=${result.shipFrom ?? "-"}`
    );
    res.json(result);
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[Extract] Shipping label extraction failed after ${ms}ms (${sizeKb}KB image):`, err);
    res.status(502).json({
      error: "EXTRACTION_FAILED",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/extract/document-text
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { text: "transcribed contents…" }
 *
 * Used by the PWA to embed a hidden, searchable text layer into the PDF
 * before SharePoint upload. Result: PDFs that are findable via Acrobat
 * Ctrl-F, SharePoint search, or any downstream indexer — without depending
 * on SharePoint's auto-OCR being timely or even enabled.
 */
router.post("/document-text", async (req, res) => {
  if (!isVisionConfigured()) {
    res.status(503).json({
      error: "VISION_UNAVAILABLE",
      message: "ANTHROPIC_API_KEY not configured on the proxy",
    });
    return;
  }

  const parsed = parseImageDataUrl(req.body?.image);
  if (!parsed.ok) {
    res.status(parsed.status).json(parsed.body);
    return;
  }

  const user = (req as any).user as { email?: string } | undefined;
  const sizeKb = Math.round((parsed.data.length * 3) / 4 / 1024);
  const t0 = Date.now();
  try {
    const text = await transcribeDocument(parsed.data, parsed.mediaType);
    const ms = Date.now() - t0;
    console.log(
      `[Extract] Document text for ${user?.email ?? "unknown"} ` +
        `(${sizeKb}KB image, ${ms}ms): ${text.length} chars`
    );
    res.json({ text });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[Extract] Document transcription failed after ${ms}ms (${sizeKb}KB image):`, err);
    res.status(502).json({
      error: "EXTRACTION_FAILED",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
