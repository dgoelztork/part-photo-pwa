import { Router } from "express";
import {
  getUpsRate,
  isUpsConfigured,
  shippingSpeedToServiceCode,
} from "../services/ups-rating.js";

const router = Router();

/** Pull pounds out of strings like "4.3 LBS", "12 lb", "2.7". Returns null if unparseable. */
function parseWeightLbs(raw: unknown): number | null {
  if (typeof raw === "number" && isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== "string") return null;
  const m = /(\d+(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isFinite(n) && n > 0 ? n : null;
}

/** Trim ZIP+4 down to 5 digits; return null if no 5-digit zip can be extracted. */
function normalizeZip(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /(\d{5})/.exec(raw);
  return m ? m[1] : null;
}

/**
 * POST /api/freight/ups-rate
 * Body: { originZip: string, weight: string | number, shippingSpeed?: string }
 * Returns: { serviceCode, serviceName, currency, listAmount, negotiatedAmount, billingWeightLbs }
 *
 * Returns 503 if UPS_CLIENT_ID isn't configured. The PWA treats 503 as
 * "rate lookup unavailable" and silently hides the estimate.
 */
router.post("/ups-rate", async (req, res) => {
  if (!isUpsConfigured()) {
    res.status(503).json({
      error: "UPS_UNAVAILABLE",
      message: "UPS rating not configured on the proxy",
    });
    return;
  }

  const originZip = normalizeZip(req.body?.originZip);
  const weightLbs = parseWeightLbs(req.body?.weight);
  if (!originZip) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "originZip must be a 5-digit US ZIP",
    });
    return;
  }
  if (!weightLbs) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "weight must be a positive number of pounds",
    });
    return;
  }

  const serviceCode = shippingSpeedToServiceCode(req.body?.shippingSpeed);
  const user = (req as any).user as { email?: string } | undefined;
  const t0 = Date.now();
  try {
    const result = await getUpsRate({ originZip, weightLbs, serviceCode });
    const ms = Date.now() - t0;
    const shown = result.negotiatedAmount ?? result.listAmount;
    console.log(
      `[UPS] Rate for ${user?.email ?? "unknown"} (${ms}ms): ` +
        `${originZip} -> dest, ${weightLbs} LBS, svc=${serviceCode} (${result.serviceName}) -> ` +
        `$${shown.toFixed(2)} ${result.negotiatedAmount != null ? "(negotiated)" : "(list)"}`
    );
    res.json(result);
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[UPS] Rate lookup failed after ${ms}ms:`, err);
    res.status(502).json({
      error: "RATE_LOOKUP_FAILED",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
