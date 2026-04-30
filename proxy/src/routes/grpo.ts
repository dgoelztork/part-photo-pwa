import { Router } from "express";
import { slFetch, parseSLError } from "../services/sl-session.js";

const router = Router();

interface GRPOLineInput {
  baseEntry: number;
  baseLine: number;
  itemCode: string;
  quantity: number;
  warehouse: string;
}

interface GRPOInput {
  vendorCode: string;
  poDocEntry: number;
  lines: GRPOLineInput[];
  comments?: string;
  /**
   * Catch-all dump of fields collected by the PWA that don't have a dedicated
   * SAP destination today (box damage notes, shipping detail edits, carrier,
   * per-line condition/notes, etc.). Written to OPDN.U_GoodsReturnComment.
   */
  goodsReturnComment?: string;
}

/**
 * POST /api/grpo
 * Post a Goods Receipt PO to SAP.
 */
router.post("/", async (req, res) => {
  const input = req.body as GRPOInput;
  const user = (req as any).user;

  // Validation
  if (!input.vendorCode || !input.poDocEntry || !input.lines?.length) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "vendorCode, poDocEntry, and at least one line are required",
    });
    return;
  }

  // Validate no zero-quantity lines
  const invalidLines = input.lines.filter((l) => l.quantity <= 0);
  if (invalidLines.length > 0) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "All lines must have quantity > 0",
    });
    return;
  }

  console.log(
    `[GRPO] Posting GRPO for vendor ${input.vendorCode}, PO DocEntry ${input.poDocEntry}, ` +
      `${input.lines.length} lines by ${user?.email ?? "unknown"}`
  );

  const slPayload: Record<string, unknown> = {
    DocDate: new Date().toISOString().slice(0, 10),
    CardCode: input.vendorCode,
    Comments:
      input.comments ??
      `Received via Part Receiving PWA by ${user?.email ?? "unknown"}`,
    DocumentLines: input.lines.map((line) => ({
      BaseEntry: line.baseEntry,
      BaseLine: line.baseLine,
      BaseType: 22, // Purchase Order
      ItemCode: line.itemCode,
      Quantity: line.quantity,
      WarehouseCode: line.warehouse,
    })),
  };

  if (input.goodsReturnComment && input.goodsReturnComment.trim()) {
    slPayload.U_GoodsReturnComment = input.goodsReturnComment;
  }

  try {
    const slRes = await slFetch("/PurchaseDeliveryNotes", {
      method: "POST",
      body: JSON.stringify(slPayload),
    });

    if (!slRes.ok) {
      const err = await parseSLError(slRes);
      console.error(`[GRPO] SL error:`, err);

      // Map common SL errors
      let errorCode = "SL_ERROR";
      if (err.message.includes("exceeds")) errorCode = "QTY_EXCEEDS_OPEN";
      if (err.message.includes("locked")) errorCode = "DOC_LOCKED";

      res.status(slRes.status).json({
        error: errorCode,
        code: err.code,
        message: err.message,
      });
      return;
    }

    const result = await slRes.json() as Record<string, any>;
    console.log(
      `[GRPO] Posted successfully: DocEntry=${result.DocEntry}, DocNum=${result.DocNum}`
    );

    res.json({
      docEntry: result.DocEntry,
      docNum: result.DocNum,
    });
  } catch (err) {
    console.error("[GRPO] Error posting:", err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to post GRPO",
    });
  }
});

/**
 * GET /api/grpo/:docEntry
 * Get a posted GRPO by DocEntry.
 */
router.get("/:docEntry", async (req, res) => {
  const { docEntry } = req.params;

  try {
    const slRes = await slFetch(`/PurchaseDeliveryNotes(${docEntry})`);

    if (!slRes.ok) {
      const err = await parseSLError(slRes);
      res.status(slRes.status).json({ error: "SL_ERROR", message: err.message });
      return;
    }

    const data = await slRes.json() as Record<string, any>;
    res.json({
      docEntry: data.DocEntry,
      docNum: data.DocNum,
      vendorCode: data.CardCode,
      vendorName: data.CardName,
      docDate: data.DocDate,
      lines: (data.DocumentLines ?? []).map((l: Record<string, unknown>) => ({
        lineNum: l.LineNum,
        itemCode: l.ItemCode,
        quantity: l.Quantity,
      })),
    });
  } catch (err) {
    console.error(`[GRPO] Error fetching ${docEntry}:`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to fetch GRPO" });
  }
});

export default router;
