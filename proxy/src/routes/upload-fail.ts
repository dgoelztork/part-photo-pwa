import { Router } from "express";

const router = Router();

/** One line of free text, bounded. A report must never be able to flood or
 *  forge log lines. */
function clip(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /api/upload-fail
 * Body: { step, docNum?, poNumber?, sent?, total?, hidden?, reason?, trigger?, secondsSinceStart? }
 *
 * The phone's account of a photo upload that failed or was cut off. Until this
 * existed the server only ever saw silence after a receipt posted, so whether
 * the screen locked, the Wi-Fi dropped or SharePoint refused could only be
 * guessed. One `[UploadFail]` line per report; nothing is stored or acted on.
 *
 * Who sent it comes from the signed-in user, not the body. Always 204: the
 * phone ignores the answer, and a report must never get in a receiver's way.
 */
router.post("/", (req, res) => {
  const b = req.body ?? {};
  const user = (req as any).user?.email ?? "unknown";
  const docNum = num(b.docNum);
  const sent = num(b.sent);
  const total = num(b.total);
  const secs = num(b.secondsSinceStart);
  console.warn(
    `[UploadFail] ${user}: ${clip(b.step, 20) || "?"}` +
      (docNum !== null ? ` GRPO ${docNum}` : "") +
      (b.poNumber ? ` PO ${clip(b.poNumber, 20)}` : "") +
      (sent !== null && total !== null ? `, sent ${sent} of ${total}` : "") +
      `, page ${b.hidden ? "WAS HIDDEN" : "stayed open"}` +
      (secs !== null ? `, ${Math.round(secs)}s after start` : "") +
      (b.trigger ? `, via ${clip(b.trigger, 10)}` : "") +
      (b.reason ? ` — ${clip(b.reason, 300)}` : "")
  );
  res.status(204).end();
});

export default router;
