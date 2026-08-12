import { Router } from "express";
import {
  insertFileCards,
  isCardsConfigured,
  pingCardsDatabase,
  type FileCardInput,
} from "../services/file-cards.js";

const router = Router();

/** Guard against a runaway client — a receipt is tens of files, not thousands. */
const MAX_CARDS_PER_CALL = 500;

/**
 * GET /api/file-cards/health
 * Confirms the proxy can reach the data database. Handy after a deploy.
 */
router.get("/health", async (_req, res) => {
  const result = await pingCardsDatabase();
  res.status(result.ok ? 200 : 503).json(result);
});

/**
 * POST /api/file-cards
 * Body: { cards: [{ container, blobName, kind, partNumber, ... }] }
 * Returns: { inserted, duplicate, failed }
 *
 * Who captured the evidence comes from the signed-in user, not the request
 * body, so attribution cannot be spoofed by the client.
 */
router.post("/", async (req, res) => {
  if (!isCardsConfigured()) {
    res.status(503).json({
      error: "CARDS_UNAVAILABLE",
      message: "DATA_SQL_* not configured on the proxy",
    });
    return;
  }

  const cards = req.body?.cards;
  if (!Array.isArray(cards)) {
    res.status(400).json({
      error: "INVALID_BODY",
      message: "Body must include a 'cards' array",
    });
    return;
  }
  if (cards.length > MAX_CARDS_PER_CALL) {
    res.status(413).json({
      error: "TOO_MANY_CARDS",
      message: `At most ${MAX_CARDS_PER_CALL} cards per request`,
    });
    return;
  }

  const user = (req as any).user as { email?: string } | undefined;
  const t0 = Date.now();
  try {
    const result = await insertFileCards(cards as FileCardInput[], user?.email ?? null);
    console.log(
      `[FileCards] ${user?.email ?? "unknown"}: ` +
        `${result.inserted} carded, ${result.duplicate} already known, ` +
        `${result.failed} failed (${Date.now() - t0}ms)`
    );
    res.json(result);
  } catch (err) {
    console.error(`[FileCards] Insert failed after ${Date.now() - t0}ms:`, err);
    res.status(502).json({
      error: "CARD_WRITE_FAILED",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
