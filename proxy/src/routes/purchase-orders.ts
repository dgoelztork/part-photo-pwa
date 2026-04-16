import { Router } from "express";
import { slFetch, parseSLError } from "../services/sl-session.js";

const router = Router();

/**
 * GET /api/po/:poNumber
 * Look up a Purchase Order by DocNum. Returns PO header + lines with open quantities.
 */
router.get("/:poNumber", async (req, res) => {
  const { poNumber } = req.params;
  console.log(`[PO] Looking up PO ${poNumber}...`);

  try {
    const slRes = await slFetch(
      `/PurchaseOrders?$filter=DocNum eq ${encodeURIComponent(poNumber)}` +
        `&$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocumentLines`
    );

    if (!slRes.ok) {
      const err = await parseSLError(slRes);
      console.error(`[PO] SL error:`, err);
      res.status(slRes.status).json({
        error: "SL_ERROR",
        code: err.code,
        message: err.message,
      });
      return;
    }

    const data = await slRes.json() as Record<string, any>;
    const results = data.value ?? [];

    if (results.length === 0) {
      res.status(404).json({
        error: "PO_NOT_FOUND",
        message: `PO ${poNumber} not found in SAP`,
      });
      return;
    }

    const po = results[0];
    const lines = (po.DocumentLines ?? []).map((line: Record<string, unknown>) => ({
      lineNum: line.LineNum,
      itemCode: line.ItemCode,
      itemDescription: line.ItemDescription,
      orderedQty: line.Quantity,
      openQty: line.RemainingOpenQuantity,
      unitPrice: line.UnitPrice,
      warehouse: line.WarehouseCode,
      uom: line.UoMCode ?? line.MeasureUnit ?? "EA",
    }));

    // Filter to only lines with open quantity
    const openLines = lines.filter((l: { openQty: number }) => l.openQty > 0);

    const result = {
      docEntry: po.DocEntry,
      docNum: po.DocNum,
      vendorCode: po.CardCode,
      vendorName: po.CardName,
      orderDate: po.DocDate,
      lines: openLines,
      totalLines: lines.length,
      openLineCount: openLines.length,
    };

    console.log(
      `[PO] Found PO ${poNumber}: ${result.vendorName}, ${openLines.length} open lines`
    );
    res.json(result);
  } catch (err) {
    console.error(`[PO] Error looking up PO ${poNumber}:`, err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to look up PO",
    });
  }
});

export default router;
