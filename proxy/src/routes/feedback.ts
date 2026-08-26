import { Router } from "express";
import {
  insertFeedback,
  isFeedbackConfigured,
  isImageDataUrl,
  isValidKind,
  pingFeedbackDatabase,
} from "../services/feedback-store.js";

const router = Router();

const MAX_TITLE = 200;
const MAX_BODY = 5000;
/** A phone photo as base64 runs ~1.3x its byte size; 4 MB of data URL is plenty. */
const MAX_PHOTO_CHARS = 4_000_000;

/**
 * GET /api/feedback/health
 * Confirms the proxy can reach Scupper's feedback board.
 */
router.get("/health", async (_req, res) => {
  const result = await pingFeedbackDatabase();
  res.status(result.ok ? 200 : 503).json(result);
});

/**
 * POST /api/feedback
 * Body: { kind: "bug" | "idea", title, body?, page?, photo? }
 *
 * Lands on Scupper's board alongside the sales team's submissions.
 */
router.post("/", async (req, res) => {
  if (!isFeedbackConfigured()) {
    res.status(503).json({
      error: "FEEDBACK_UNAVAILABLE",
      message: "Feedback is not configured on the proxy (FEEDBACK_DATABASE_URL)",
    });
    return;
  }

  const { kind, title, body, page, photo } = req.body ?? {};

  if (!isValidKind(kind)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: 'kind must be "bug" or "idea"' });
    return;
  }

  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "title is required" });
    return;
  }

  // Who submitted comes from the verified token, never the request body —
  // same rule as file-cards, so attribution can't be spoofed by a client.
  const user = (req as any).user as { email?: string } | undefined;

  // A photo that isn't a real image data URL is dropped rather than rejected:
  // losing the picture shouldn't cost the receiver their written report.
  let photoDataUrl: string | null = null;
  if (typeof photo === "string" && photo.length > 0) {
    if (photo.length > MAX_PHOTO_CHARS) {
      console.warn(`[Feedback] Photo dropped: ${photo.length} chars exceeds the limit`);
    } else if (!isImageDataUrl(photo)) {
      console.warn("[Feedback] Photo dropped: not a base64 image data URL");
    } else {
      photoDataUrl = photo;
    }
  }

  // Prefix so Scupper's board shows which app a submission came from —
  // its own rows carry paths like "/rfq/375281".
  const rawPage = typeof page === "string" ? page.trim().slice(0, 120) : "";
  const taggedPage = `receiving:${rawPage || "/"}`;

  try {
    const row = await insertFeedback({
      kind,
      title: cleanTitle.slice(0, MAX_TITLE),
      body: typeof body === "string" && body.trim() ? body.trim().slice(0, MAX_BODY) : null,
      page: taggedPage,
      userEmail: user?.email ?? null,
      photoDataUrl,
    });

    console.log(
      `[Feedback] #${row.id} (${row.kind}) from ${user?.email ?? "unknown"} ` +
        `on ${taggedPage}${photoDataUrl ? " with photo" : ""}: ${row.title}`
    );
    res.status(201).json(row);
  } catch (err) {
    console.error("[Feedback] Insert failed:", err);
    res.status(502).json({
      error: "FEEDBACK_SAVE_FAILED",
      message: err instanceof Error ? err.message : "Could not save feedback",
    });
  }
});

export default router;
