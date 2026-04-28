import { Router } from "express";
import {
  extractShippingLabel,
  isVisionConfigured,
} from "../services/anthropic-vision.js";

const router = Router();

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

  const { image } = req.body ?? {};
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    res.status(400).json({
      error: "INVALID_IMAGE",
      message: "Body must include image as a data URL: 'data:image/jpeg;base64,...'",
    });
    return;
  }

  // Parse the data URL: "data:image/jpeg;base64,<payload>"
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(image);
  if (!match) {
    res.status(400).json({
      error: "INVALID_IMAGE",
      message: "Image must be JPEG, PNG, WebP, or GIF as a base64 data URL",
    });
    return;
  }
  const mediaType = match[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  const data = match[2];

  const user = (req as any).user as { email?: string } | undefined;
  const sizeKb = Math.round((data.length * 3) / 4 / 1024); // base64 → bytes → KB
  const t0 = Date.now();
  try {
    const result = await extractShippingLabel(data, mediaType);
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

export default router;
