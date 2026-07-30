import { Router } from "express";
import { slFetch, parseSLError } from "../services/sl-session.js";

const router = Router();

interface WarehouseStock {
  warehouse: string;
  inStock: number;
  committed: number;
  ordered: number;
}

interface ItemStock {
  total: number;
  byWarehouse: WarehouseStock[];
}

/** OData string literals escape a single quote by doubling it. */
function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Live on-hand for a set of item codes. Batched — SL takes an `or` chain of
 * ItemCode filters, but a long URL will 400, so chunk it.
 *
 * Stock is deliberately read LIVE rather than from the SO line's stored
 * U_01Stock / U_TotalAvailable UDFs: those are stamped when the line is
 * entered and go stale immediately (observed U_TotalAvailable="0.00" on an
 * item with 2 on hand). The whole point of this sheet is post-receipt truth.
 */
async function fetchStock(itemCodes: string[]): Promise<Map<string, ItemStock>> {
  const stock = new Map<string, ItemStock>();
  const CHUNK = 15;

  for (let i = 0; i < itemCodes.length; i += CHUNK) {
    const chunk = itemCodes.slice(i, i + CHUNK);
    const filter = chunk.map((c) => `ItemCode eq '${escapeODataString(c)}'`).join(" or ");

    const res = await slFetch(
      `/Items?$filter=${encodeURIComponent(filter)}` +
        `&$select=ItemCode,QuantityOnStock,ItemWarehouseInfoCollection`
    );

    // Stock is best-effort: a failure here shouldn't sink the whole picklist.
    // The receiver still gets the SO lines, just without on-hand numbers.
    if (!res.ok) {
      const err = await parseSLError(res);
      console.warn(`[Picklist] Stock lookup failed for chunk ${i / CHUNK}:`, err.message);
      continue;
    }

    const data = (await res.json()) as Record<string, any>;
    for (const item of data.value ?? []) {
      const byWarehouse: WarehouseStock[] = (item.ItemWarehouseInfoCollection ?? [])
        .map((w: Record<string, any>) => ({
          warehouse: w.WarehouseCode,
          inStock: w.InStock ?? 0,
          committed: w.Committed ?? 0,
          ordered: w.Ordered ?? 0,
        }))
        // Drop the long tail of warehouses this item has never touched.
        .filter((w: WarehouseStock) => w.inStock !== 0 || w.committed !== 0 || w.ordered !== 0);

      stock.set(item.ItemCode, {
        total: item.QuantityOnStock ?? 0,
        byWarehouse,
      });
    }
  }

  return stock;
}

/**
 * GET /api/picklist/:poNumber
 *
 * Builds the pick sheet for the sales order a PO was raised against.
 * OPOR.U_pSONumber holds the SO DocNum as a string (e.g. "35875"); one SO is
 * commonly fed by several vendor POs, so the SO — not the PO — is the unit of
 * picking. Each SO line carries POTargetNum (the PO DocNum it was ordered on),
 * which is how lines belonging to *this* receipt get flagged.
 */
router.get("/:poNumber", async (req, res) => {
  const { poNumber } = req.params;
  console.log(`[Picklist] Building picklist for PO ${poNumber}...`);

  try {
    // 1. PO header — we only need the SO reference off it.
    const poRes = await slFetch(
      `/PurchaseOrders?$filter=DocNum eq ${encodeURIComponent(poNumber)}` +
        `&$select=DocEntry,DocNum,CardName,U_pSONumber`
    );

    if (!poRes.ok) {
      const err = await parseSLError(poRes);
      console.error(`[Picklist] PO lookup failed:`, err);
      res.status(poRes.status).json({ error: "SL_ERROR", code: err.code, message: err.message });
      return;
    }

    const poData = (await poRes.json()) as Record<string, any>;
    const po = (poData.value ?? [])[0];

    if (!po) {
      res.status(404).json({ error: "PO_NOT_FOUND", message: `PO ${poNumber} not found in SAP` });
      return;
    }

    const soNumberRaw = String(po.U_pSONumber ?? "").trim();
    if (!soNumberRaw) {
      res.status(404).json({
        error: "NO_SO_LINKED",
        message: `PO ${poNumber} has no sales order linked (U_pSONumber is empty)`,
      });
      return;
    }

    // DocNum is an integer column in SL, so the filter can't be quoted. If
    // someone typed something non-numeric into the UDF, say so plainly rather
    // than emitting a filter that SL will reject with a parse error.
    if (!/^\d+$/.test(soNumberRaw)) {
      res.status(422).json({
        error: "SO_REF_NOT_NUMERIC",
        message: `PO ${poNumber} references sales order "${soNumberRaw}", which isn't a plain SO number`,
      });
      return;
    }

    // 2. The sales order — header plus every line.
    const soRes = await slFetch(
      `/Orders?$filter=DocNum eq ${soNumberRaw}` +
        `&$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocumentStatus,` +
        `NumAtCard,ShipToCode,Address2,Comments,U_VesselNameJobNumber,DocumentLines`
    );

    if (!soRes.ok) {
      const err = await parseSLError(soRes);
      console.error(`[Picklist] SO lookup failed:`, err);
      res.status(soRes.status).json({ error: "SL_ERROR", code: err.code, message: err.message });
      return;
    }

    const soData = (await soRes.json()) as Record<string, any>;
    const so = (soData.value ?? [])[0];

    if (!so) {
      res.status(404).json({
        error: "SO_NOT_FOUND",
        message: `Sales order ${soNumberRaw} (from PO ${poNumber}) not found in SAP`,
      });
      return;
    }

    const rawLines: Record<string, any>[] = so.DocumentLines ?? [];

    // 3. Live stock for everything on the order.
    const itemCodes = [...new Set(rawLines.map((l) => String(l.ItemCode)).filter(Boolean))];
    const stock = await fetchStock(itemCodes);

    const poDocNum = po.DocNum;

    const lines = rawLines.map((l) => {
      const itemStock = stock.get(String(l.ItemCode));
      const warehouse = l.WarehouseCode ?? "";
      const atWarehouse = itemStock?.byWarehouse.find((w) => w.warehouse === warehouse);

      return {
        lineNum: l.LineNum,
        customerLineNo: l.U_CustomerLineNo ?? "",
        itemCode: l.ItemCode,
        itemDescription: l.ItemDescription,
        orderedQty: l.Quantity ?? 0,
        openQty: l.RemainingOpenQuantity ?? 0,
        warehouse,
        uom: l.UoMCode ?? l.MeasureUnit ?? "EA",
        // bost_Close / bost_Open — closed lines have already shipped.
        closed: l.LineStatus === "bost_Close",
        pickStatus: l.PickStatus ?? "",
        pickedQty: l.PickQuantity ?? 0,
        // Which PO this SO line was ordered on. Matches the PO just received
        // for the lines this GRPO actually filled.
        poTargetNum: l.POTargetNum ?? null,
        fromThisPo: l.POTargetNum === poDocNum,
        onHandTotal: itemStock?.total ?? null,
        onHandAtWarehouse: atWarehouse?.inStock ?? (itemStock ? 0 : null),
        stockByWarehouse: itemStock?.byWarehouse ?? [],
        freeText: l.FreeText ?? "",
        serial: l.U_Serial ?? "",
        tag: l.U_Tag ?? "",
        condition: l.U_Condition ?? "",
        customerPartNo: l.U_CustomerPartNo ?? "",
      };
    });

    const result = {
      poNumber: poDocNum,
      poDocEntry: po.DocEntry,
      vendorName: po.CardName ?? "",
      soNumber: so.DocNum,
      soDocEntry: so.DocEntry,
      customerCode: so.CardCode ?? "",
      customerName: so.CardName ?? "",
      customerPO: so.NumAtCard ?? "",
      shipToCode: so.ShipToCode ?? "",
      // SAP stores the address with \r line breaks; normalise for display.
      shipToAddress: String(so.Address2 ?? "").replace(/\r\n?/g, "\n").trim(),
      vesselJob: so.U_VesselNameJobNumber ?? "",
      soComments: so.Comments ?? "",
      orderDate: so.DocDate ?? null,
      dueDate: so.DocDueDate ?? null,
      soStatus: so.DocumentStatus ?? "",
      lines,
      openLineCount: lines.filter((l) => !l.closed).length,
      closedLineCount: lines.filter((l) => l.closed).length,
      generatedAt: new Date().toISOString(),
    };

    console.log(
      `[Picklist] PO ${poNumber} → SO ${so.DocNum} (${result.customerName}): ` +
        `${result.openLineCount} open / ${lines.length} lines, ` +
        `${lines.filter((l) => l.fromThisPo).length} from this PO`
    );
    res.json(result);
  } catch (err) {
    console.error(`[Picklist] Error building picklist for PO ${poNumber}:`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to build picklist" });
  }
});

export default router;
