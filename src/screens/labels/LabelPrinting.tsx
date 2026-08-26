import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchPrinters,
  lookupSalesOrder,
  printItemLabels,
  NoPrinterError,
  type LabelPrinter,
  type LabelSalesOrder,
  type LabelSOLine,
} from "../../services/api-client";
import { TailscaleHint } from "../../components/TailscaleHint";

/**
 * Item label printing — search a sales order, pick the part, choose how many
 * labels, send to the Zebra at that site.
 *
 * Deliberately separate from the receiving wizard: this is a standalone job
 * someone does at a bench, not a step in receiving a shipment. It shares the
 * proxy and auth but no session state.
 */
export function LabelPrinting() {
  const navigate = useNavigate();
  const [soInput, setSoInput] = useState("");
  const [order, setOrder] = useState<LabelSalesOrder | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LabelSOLine | null>(null);
  const [printers, setPrinters] = useState<LabelPrinter[]>([]);

  useEffect(() => {
    // Best-effort: the screen still works if this fails, it just can't offer
    // a manual printer choice.
    void fetchPrinters()
      .then(setPrinters)
      .catch((err) => console.warn("[Labels] Could not load printers:", err));
  }, []);

  const handleSearch = async () => {
    const so = soInput.trim();
    if (!so) return;
    setSearching(true);
    setSearchError(null);
    setOrder(null);
    setSelected(null);
    try {
      setOrder(await lookupSalesOrder(so));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="text-primary text-sm font-medium px-2 py-1 -ml-2"
        >
          &larr; Back
        </button>
        <h2 className="text-lg font-semibold text-text">Print Item Labels</h2>
      </div>

      {/* Sales order search */}
      <div className="bg-surface rounded-xl p-4 shadow-sm flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Sales Order Number</span>
          <input
            type="text"
            inputMode="numeric"
            value={soInput}
            onChange={(e) => setSoInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            placeholder="e.g. 35875"
            className="border border-border rounded-lg px-3 py-3 text-base"
          />
        </label>
        <button
          onClick={() => void handleSearch()}
          disabled={searching || !soInput.trim()}
          className="w-full py-3 rounded-xl bg-primary text-white font-semibold
                     disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {searching ? "Searching…" : "Find Order"}
        </button>
      </div>

      {searchError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-slide-in">
          <p className="text-sm font-semibold text-error">Couldn't find that order</p>
          <p className="text-xs text-text-secondary mt-1">{searchError}</p>
          <TailscaleHint />
        </div>
      )}

      {order && !selected && <OrderLines order={order} onPick={setSelected} />}

      {order && selected && (
        <PrintPanel
          order={order}
          line={selected}
          printers={printers}
          onBack={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function OrderLines({
  order,
  onPick,
}: {
  order: LabelSalesOrder;
  onPick: (line: LabelSOLine) => void;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const lines = needle
    ? order.lines.filter(
        (l) =>
          l.itemCode.toLowerCase().includes(needle) ||
          l.itemDescription.toLowerCase().includes(needle)
      )
    : order.lines;

  return (
    <div className="flex flex-col gap-3 animate-slide-in">
      <div className="bg-surface rounded-xl p-3 shadow-sm">
        <p className="text-sm font-semibold text-text">SO {order.soNumber}</p>
        <p className="text-xs text-text-secondary">{order.customerName}</p>
        {order.customerPO && (
          <p className="text-xs text-text-secondary">Cust PO: {order.customerPO}</p>
        )}
      </div>

      {/* A 21-line order is common; typing beats scrolling on a phone. */}
      {order.lines.length > 6 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by part number or description"
          className="border border-border rounded-lg px-3 py-3 text-base"
        />
      )}

      <p className="text-xs text-text-secondary">
        {lines.length} of {order.lines.length} line{order.lines.length !== 1 ? "s" : ""} — tap a
        part to label
      </p>

      <div className="flex flex-col gap-2">
        {lines.map((line) => (
          <button
            key={line.lineNum}
            onClick={() => onPick(line)}
            className="bg-surface rounded-xl p-3 shadow-sm text-left active:scale-[0.99] transition-transform"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-text">{line.itemCode}</p>
                <p className="text-xs text-text-secondary break-words">{line.itemDescription}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-text">{line.orderedQty}</p>
                <p className="text-xs text-text-secondary">{line.warehouse || "—"}</p>
              </div>
            </div>
            {line.closed && (
              <p className="text-xs text-text-secondary mt-1">Line closed (already shipped)</p>
            )}
          </button>
        ))}
        {lines.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-4">
            No part on this order matches "{filter}".
          </p>
        )}
      </div>
    </div>
  );
}

function PrintPanel({
  order,
  line,
  printers,
  onBack,
}: {
  order: LabelSalesOrder;
  line: LabelSOLine;
  printers: LabelPrinter[];
  onBack: () => void;
}) {
  // Dylan's spec: default the count to the order quantity, one label per piece.
  const [copies, setCopies] = useState(String(line.orderedQty || 1));
  const [printerId, setPrinterId] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "printing" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needPrinterChoice, setNeedPrinterChoice] = useState(false);

  const copiesNum = parseInt(copies, 10);
  const copiesValid = isFinite(copiesNum) && copiesNum >= 1 && copiesNum <= 200;

  // Which printer serves this line's warehouse, for display.
  const autoPrinter = printers.find((p) =>
    p.warehouses.some((w) => w.toUpperCase() === (line.warehouse || "").toUpperCase())
  );

  const handlePrint = async () => {
    setStatus("printing");
    setError(null);
    try {
      const result = await printItemLabels({
        itemCode: line.itemCode,
        itemDescription: line.itemDescription,
        orderedQty: line.orderedQty,
        soNumber: order.soNumber,
        customerName: order.customerName,
        customerPartNo: line.customerPartNo || null,
        warehouse: line.warehouse || null,
        copies: copiesNum,
        printerId: printerId || undefined,
      });
      setStatus("sent");
      setError(
        `${result.copies} label${result.copies !== 1 ? "s" : ""} sent to ${result.printerName}`
      );
    } catch (err) {
      setStatus("error");
      if (err instanceof NoPrinterError) {
        setNeedPrinterChoice(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Print failed");
      }
    }
  };

  return (
    <div className="flex flex-col gap-3 animate-slide-in">
      <button onClick={onBack} className="text-primary text-sm font-medium text-left">
        &larr; Pick a different part
      </button>

      <div className="bg-surface rounded-xl p-4 shadow-sm">
        <p className="text-lg font-bold text-text">{line.itemCode}</p>
        <p className="text-sm text-text-secondary">{line.itemDescription}</p>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-text-secondary">
          <span>SO {order.soNumber}</span>
          <span className="text-right">Warehouse {line.warehouse || "—"}</span>
          <span>Order qty {line.orderedQty}</span>
          <span className="text-right">{line.uom}</span>
        </div>
      </div>

      <div className="bg-surface rounded-xl p-4 shadow-sm flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">
            How many labels? (defaults to order quantity)
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={copies}
            onChange={(e) => setCopies(e.target.value.replace(/[^0-9]/g, ""))}
            className="border border-border rounded-lg px-3 py-3 text-2xl font-semibold text-center"
          />
        </label>
        {!copiesValid && copies !== "" && (
          <p className="text-xs text-error">Enter a number between 1 and 200.</p>
        )}

        {/* Normally routed by warehouse; the picker appears when that fails
            or when someone needs to override the destination. */}
        {(needPrinterChoice || printers.length > 1) && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">Printer</span>
            <select
              value={printerId}
              onChange={(e) => setPrinterId(e.target.value)}
              className="border border-border rounded-lg px-3 py-3 text-base bg-surface"
            >
              <option value="">
                {autoPrinter
                  ? `Automatic — ${autoPrinter.name}`
                  : "Automatic (by warehouse)"}
              </option>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          onClick={() => void handlePrint()}
          disabled={!copiesValid || status === "printing"}
          className="w-full py-4 rounded-xl bg-primary text-white font-semibold text-lg
                     disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {status === "printing"
            ? "Sending…"
            : `Print ${copiesValid ? copiesNum : ""} Label${copiesNum === 1 ? "" : "s"}`}
        </button>
      </div>

      {status === "sent" && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 animate-slide-in">
          <p className="text-sm font-semibold text-success">Sent to printer</p>
          <p className="text-xs text-text-secondary mt-1">{error}</p>
          {/* The printer never reports back over a raw socket, so don't claim
              more than we know. */}
          <p className="text-xs text-text-secondary mt-2">
            Check the printer — if nothing came out, it may be out of labels or have its head
            open.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-slide-in">
          <p className="text-sm font-semibold text-error">Couldn't print</p>
          <p className="text-xs text-text-secondary mt-1">{error}</p>
          {needPrinterChoice && printers.length > 0 && (
            <p className="text-xs text-text-secondary mt-2">Pick a printer above and try again.</p>
          )}
          {!needPrinterChoice && <TailscaleHint />}
        </div>
      )}
    </div>
  );
}
