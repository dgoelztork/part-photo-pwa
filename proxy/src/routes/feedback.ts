import { Router } from "express";
import {
  getFeedbackPhoto,
  insertFeedback,
  isImageDataUrl,
  isValidKind,
  isValidStatus,
  listFeedback,
  pingFeedbackStore,
  updateFeedbackStatus,
} from "../services/feedback-store.js";

const router = Router();

const MAX_TITLE = 200;
const MAX_BODY = 5000;
/** A phone photo as base64 runs ~1.3x its byte size; 4 MB of data URL is plenty. */
const MAX_PHOTO_CHARS = 4_000_000;

/** GET /api/feedback/health — is the store readable? */
router.get("/health", (_req, res) => {
  const result = pingFeedbackStore();
  res.status(result.ok ? 200 : 503).json(result);
});

/**
 * GET /api/feedback?status=open
 * Newest first. Photos aren't included — the list carries a flag and the
 * image is fetched per row, so one screen doesn't drag down megabytes.
 */
router.get("/", (req, res) => {
  const status = req.query.status;
  if (status !== undefined && !isValidStatus(status)) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "status must be open, in_progress or closed",
    });
    return;
  }
  try {
    res.json({ feedback: listFeedback(status as any) });
  } catch (err) {
    console.error("[Feedback] List failed:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not read feedback" });
  }
});

/** GET /api/feedback/:id/photo — the attached photo, decoded. */
router.get("/:id/photo", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "id must be a number" });
    return;
  }
  const dataUrl = getFeedbackPhoto(id);
  if (!dataUrl) {
    res.status(404).json({ error: "NOT_FOUND", message: "No photo on that feedback" });
    return;
  }
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    res.status(500).json({ error: "BAD_PHOTO", message: "Stored photo is not decodable" });
    return;
  }
  res.setHeader("Content-Type", match[1]);
  res.send(Buffer.from(match[2], "base64"));
});

/**
 * POST /api/feedback
 * Body: { kind: "bug" | "idea", title, body?, page?, photo? }
 */
router.post("/", (req, res) => {
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

  try {
    const row = insertFeedback({
      kind,
      title: cleanTitle.slice(0, MAX_TITLE),
      body: typeof body === "string" && body.trim() ? body.trim().slice(0, MAX_BODY) : null,
      page: typeof page === "string" ? page.trim().slice(0, 120) : null,
      userEmail: user?.email ?? null,
      photoDataUrl,
    });

    console.log(
      `[Feedback] #${row.id} (${row.kind}) from ${user?.email ?? "unknown"} ` +
        `on ${row.page ?? "/"}${photoDataUrl ? " with photo" : ""}: ${row.title}`
    );
    res.status(201).json(row);
  } catch (err) {
    console.error("[Feedback] Insert failed:", err);
    res.status(500).json({
      error: "FEEDBACK_SAVE_FAILED",
      message: err instanceof Error ? err.message : "Could not save feedback",
    });
  }
});

/** PATCH /api/feedback/:id — move a submission through open → in_progress → closed. */
router.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "id must be a number" });
    return;
  }
  const { status } = req.body ?? {};
  if (!isValidStatus(status)) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "status must be open, in_progress or closed",
    });
    return;
  }
  const row = updateFeedbackStatus(id, status);
  if (!row) {
    res.status(404).json({ error: "NOT_FOUND", message: `No feedback #${id}` });
    return;
  }
  console.log(`[Feedback] #${id} -> ${status}`);
  res.json(row);
});

export default router;
