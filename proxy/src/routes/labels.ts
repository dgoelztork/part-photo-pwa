import { Router } from "express";
import { slFetch, parseSLError } from "../services/sl-session.js";
import {
  getPrinterById,
  getPrinterForWarehouse,
  listPublicPrinters,
  sendZpl,
} from "../services/label-printer.js";
import { buildItemLabel, normalizeCopies } from "../services/zpl.js";

const router = Router();

/**
 * GET /api/labels/printers
 * Configured label printers. Network addresses stay server-side.
 */
router.get("/printers", (_req, res) => {
  res.json({ printers: listPublicPrinters() });
});

/**
 * GET /api/labels/sales-order/:soNumber
 * Sales order header + lines, shaped for picking a part to label.
 *
 * Every line is returned, including closed ones: labels get reprinted for
 * stock that already shipped, and a receiver searching for a part shouldn't
 * be told it doesn't exist because the line is closed.
 */
router.get("/sales-order/:soNumber", async (req, res) => {
  const { soNumber } = req.params;

  if (!/^\d+$/.test(soNumber)) {
    res.status(400).json({
      error: "INVALID_SO_NUMBER",
      message: "Sales order number must be digits only",
    });
    return;
  }

  console.log(`[Labels] Looking up SO ${soNumber}...`);

  try {
    const slRes = await slFetch(
      `/Orders?$filter=DocNum eq ${soNumber}` +
        `&$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocumentStatus,` +
        `NumAtCard,ShipToCode,U_VesselNameJobNumber,DocumentLines`
    );

    if (!slRes.ok) {
      const err = await parseSLError(slRes);
      console.error(`[Labels] SL error looking up SO ${soNumber}:`, err);
      res.status(slRes.status).json({ error: "SL_ERROR", code: err.code, message: err.message });
      return;
    }

    const data = (await slRes.json()) as Record<string, any>;
    const so = (data.value ?? [])[0];

    if (!so) {
      res.status(404).json({
        error: "SO_NOT_FOUND",
        message: `Sales order ${soNumber} not found in SAP`,
      });
      return;
    }

    const lines = (so.DocumentLines ?? []).map((l: Record<string, any>) => ({
      lineNum: l.LineNum,
      customerLineNo: l.U_CustomerLineNo ?? "",
      itemCode: l.ItemCode,
      itemDescription: l.ItemDescription,
      orderedQty: l.Quantity ?? 0,
      openQty: l.RemainingOpenQuantity ?? 0,
      warehouse: l.WarehouseCode ?? "",
      uom: l.UoMCode ?? l.MeasureUnit ?? "EA",
      closed: l.LineStatus === "bost_Close",
      customerPartNo: l.U_CustomerPartNo ?? "",
      freeText: l.FreeText ?? "",
    }));

    console.log(`[Labels] SO ${soNumber}: ${so.CardName}, ${lines.length} line(s)`);

    res.json({
      soNumber: so.DocNum,
      soDocEntry: so.DocEntry,
      customerCode: so.CardCode ?? "",
      customerName: so.CardName ?? "",
      customerPO: so.NumAtCard ?? "",
      shipToCode: so.ShipToCode ?? "",
      vesselJob: so.U_VesselNameJobNumber ?? "",
      orderDate: so.DocDate ?? null,
      dueDate: so.DocDueDate ?? null,
      soStatus: so.DocumentStatus ?? "",
      lines,
    });
  } catch (err) {
    console.error(`[Labels] Error looking up SO ${soNumber}:`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to look up sales order" });
  }
});

interface PrintBody {
  itemCode?: string;
  itemDescription?: string;
  orderedQty?: number | null;
  soNumber?: number | string | null;
  customerName?: string | null;
  customerPartNo?: string | null;
  warehouse?: string | null;
  copies?: number;
  /** Explicit printer choice; otherwise routed by warehouse. */
  printerId?: string;
}

/** Shared by /print and /preview so a preview shows exactly what would print. */
function buildFromBody(body: PrintBody) {
  const copies = normalizeCopies(body.copies);
  const zpl = buildItemLabel({
    itemCode: String(body.itemCode ?? ""),
    itemDescription: String(body.itemDescription ?? ""),
    orderedQty: body.orderedQty ?? null,
    soNumber: body.soNumber ?? null,
    customerName: body.customerName ?? null,
    customerPartNo: body.customerPartNo ?? null,
    warehouse: body.warehouse ?? null,
    copies,
  });
  return { zpl, copies };
}

/**
 * POST /api/labels/preview
 * Returns the ZPL that /print would send, without printing. Lets the label
 * layout be checked (and pasted into a ZPL viewer) before any printer exists.
 */
router.post("/preview", (req, res) => {
  const body = (req.body ?? {}) as PrintBody;
  if (!body.itemCode) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "itemCode is required" });
    return;
  }
  const { zpl, copies } = buildFromBody(body);
  res.json({ zpl, copies });
});

/**
 * POST /api/labels/print
 * Build the label and stream it to the site's printer.
 */
router.post("/print", async (req, res) => {
  const body = (req.body ?? {}) as PrintBody;
  const user = (req as any).user as { email?: string } | undefined;

  if (!body.itemCode) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "itemCode is required" });
    return;
  }

  // Explicit printer wins; otherwise route by the line's warehouse. There is
  // deliberately no "just use the first printer" fallback — a mis-routed label
  // prints 2,000 miles from the person who asked for it.
  const printer = body.printerId
    ? getPrinterById(body.printerId)
    : getPrinterForWarehouse(String(body.warehouse ?? ""));

  if (!printer) {
    const configured = listPublicPrinters();
    if (configured.length === 0) {
      res.status(503).json({
        error: "NO_PRINTERS_CONFIGURED",
        message: "No label printers are configured on the proxy (LABEL_PRINTERS is empty)",
      });
      return;
    }
    res.status(422).json({
      error: "NO_PRINTER_FOR_WAREHOUSE",
      message: body.printerId
        ? `No printer with id "${body.printerId}"`
        : `No printer is configured for warehouse "${body.warehouse ?? ""}" — pick one manually`,
      printers: configured,
    });
    return;
  }

  const { zpl, copies } = buildFromBody(body);
  const t0 = Date.now();

  try {
    await sendZpl(printer, zpl);
    const ms = Date.now() - t0;
    console.log(
      `[Labels] Sent ${copies} label(s) of ${body.itemCode} to ${printer.id} ` +
        `(${printer.host}:${printer.port}) in ${ms}ms for ${user?.email ?? "unknown"}`
    );
    // "sent", not "printed": a raw 9100 write is fire-and-forget, so we can't
    // tell a printed label from one that died on an out-of-media fault.
    res.json({
      sent: true,
      copies,
      printerId: printer.id,
      printerName: printer.name,
      itemCode: body.itemCode,
    });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[Labels] Print to ${printer.id} failed after ${ms}ms:`, err);
    res.status(502).json({
      error: "PRINT_FAILED",
      message: err instanceof Error ? err.message : "Failed to send label to printer",
      printerId: printer.id,
      printerName: printer.name,
    });
  }
});

export default router;
