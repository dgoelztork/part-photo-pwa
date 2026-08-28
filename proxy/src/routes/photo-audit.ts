import { Router } from "express";
import { auditRecentPhotos } from "../services/photo-audit.js";

const router = Router();

/**
 * GET /api/photo-audit?days=7
 * Receipts filed from the app whose photos never reached SharePoint.
 *
 * Cached briefly because the Dashboard asks on every open and the underlying
 * SAP walk is several round trips. A few minutes of staleness is irrelevant
 * for a problem measured in days.
 */
const CACHE_MS = 3 * 60 * 1000;
let cache: { at: number; days: number; body: unknown } | null = null;

router.get("/", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));

  if (cache && cache.days === days && Date.now() - cache.at < CACHE_MS) {
    res.json(cache.body);
    return;
  }

  try {
    const result = await auditRecentPhotos(days);
    if (result.missing.length > 0) {
      // Logged loudly as well as returned: this is the failure that hid for
      // two months, and a log line is one more place it can be noticed.
      console.warn(
        `[PhotoAudit] ${result.missing.length} of ${result.checked} app receipts ` +
          `since ${result.sinceDate} have no photos: ` +
          result.missing.map((m) => `${m.docNum}(${m.receivedBy ?? "?"})`).join(", ")
      );
    } else {
      console.log(
        `[PhotoAudit] all ${result.checked} app receipts since ${result.sinceDate} have their photos`
      );
    }
    cache = { at: Date.now(), days, body: result };
    res.json(result);
  } catch (err) {
    console.error("[PhotoAudit] Failed:", err);
    res.status(502).json({
      error: "AUDIT_FAILED",
      message: err instanceof Error ? err.message : "Could not audit photo uploads",
    });
  }
});

export default router;
