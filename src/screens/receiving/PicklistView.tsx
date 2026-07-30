import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchPicklist,
  NoSalesOrderError,
  type PicklistResult,
  type PicklistLine,
} from "../../services/api-client";
import { TailscaleHint } from "../../components/TailscaleHint";

/**
 * Pick sheet for the sales order behind the PO just received.
 *
 * Tork raises vendor POs against a customer sales order and stamps the SO
 * number on the PO header (OPOR.U_pSONumber). Most of what the warehouse
 * receives is already spoken for, so the moment a GRPO posts the useful next
 * question is "what does that let us pick?" — this sheet answers it with live
 * post-receipt stock.
 *
 * Rendered as an overlay over the review screen. Print pulls the document out
 * via the .picklist-print rules in app.css; Cancel just closes.
 */
export function PicklistView({
  poNumber,
  grpoDocNum,
  receivedByItem,
  onClose,
}: {
  poNumber: string;
  grpoDocNum: number | null;
  /** Item code → qty received on this receipt, for the RECV column. */
  receivedByItem: Record<string, number>;
  onClose: () => void;
}) {
  const [picklist, setPicklist] = useState<PicklistResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noSalesOrder, setNoSalesOrder] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await fetchPicklist(poNumber);
        if (!cancelled) setPicklist(result);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NoSalesOrderError) {
          setNoSalesOrder(true);
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "Could not load picklist");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [poNumber]);

  const loading = !picklist && !error;

  // Portalled to <body> so printing can hide #root wholesale and let the sheet
  // flow across pages instead of being clipped to the overlay's scroll box.
  return createPortal(
    <div className="picklist-overlay fixed inset-0 z-50 bg-bg flex flex-col">
      {/* Scrollable document area */}
      <div className="picklist-scroll flex-1 overflow-y-auto safe-top">
        {loading && (
          <div className="p-8 text-center">
            <p className="text-sm text-text-secondary animate-pulse-dot">
              Loading picklist from SAP…
            </p>
          </div>
        )}

        {error && (
          <div className="m-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <p className="text-sm font-semibold text-error">
              {noSalesOrder ? "No sales order linked" : "Could not load picklist"}
            </p>
            <p className="text-xs text-text-secondary mt-1">{error}</p>
            {noSalesOrder ? (
              <p className="text-xs text-text-secondary mt-2">
                This PO is stock replenishment, or the SO number was never filled in on the
                PO header. Nothing to pick — tap Cancel to finish.
              </p>
            ) : (
              <TailscaleHint />
            )}
          </div>
        )}

        {picklist && <PicklistDocument picklist={picklist} grpoDocNum={grpoDocNum} receivedByItem={receivedByItem} />}
      </div>

      {/* Actions — never printed */}
      <div className="no-print border-t border-border bg-surface p-4 safe-bottom flex flex-col gap-2">
        <button
          onClick={() => window.print()}
          disabled={!picklist}
          className="w-full py-4 rounded-xl bg-primary text-white font-semibold text-lg
                     disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          Print Picklist
        </button>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-surface border border-border text-text font-medium"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

function PicklistDocument({
  picklist,
  grpoDocNum,
  receivedByItem,
}: {
  picklist: PicklistResult;
  grpoDocNum: number | null;
  receivedByItem: Record<string, number>;
}) {
  // Closed lines have already shipped — they'd only pad the printout.
  const openLines = picklist.lines.filter((l) => !l.closed);

  // An item can sit on several SO lines (different quantities, same part). The
  // receipt qty is per item, not per line, so attribute it to the first line
  // that came off this PO rather than repeating it and implying a bigger receipt.
  const receiptShown = new Set<string>();
  const receiptFor = (line: PicklistLine): number | null => {
    if (!line.fromThisPo) return null;
    if (receiptShown.has(line.itemCode)) return null;
    const qty = receivedByItem[line.itemCode];
    if (!qty) return null;
    receiptShown.add(line.itemCode);
    return qty;
  };

  return (
    <div className="picklist-print p-4 max-w-3xl mx-auto text-text">
      {/* Header */}
      <div className="border-b-2 border-text pb-3 mb-3">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-xl font-bold">PICKLIST</h1>
            <p className="text-sm">
              Sales Order <span className="font-bold">{picklist.soNumber}</span>
            </p>
          </div>
          <div className="text-right text-xs">
            <p>
              From PO <span className="font-semibold">{picklist.poNumber}</span>
              {grpoDocNum && <> · GRPO <span className="font-semibold">{grpoDocNum}</span></>}
            </p>
            <p className="text-text-secondary">{formatDateTime(picklist.generatedAt)}</p>
          </div>
        </div>
      </div>

      {/* Order facts */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-4">
        <Field label="Customer" value={picklist.customerName} />
        <Field label="Customer PO" value={picklist.customerPO} />
        <Field label="Ship To" value={picklist.shipToCode} />
        <Field label="Due Date" value={formatDate(picklist.dueDate)} />
        {picklist.vesselJob && <Field label="Vessel / Job" value={picklist.vesselJob} />}
        {picklist.shipToAddress && (
          <div className="col-span-2">
            <span className="text-text-secondary">Address: </span>
            <span className="whitespace-pre-line">{picklist.shipToAddress}</span>
          </div>
        )}
      </div>

      {/* Lines */}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-text text-left">
            <th className="py-1 pr-1 font-semibold w-6">#</th>
            <th className="py-1 pr-2 font-semibold">Item</th>
            <th className="py-1 px-1 font-semibold text-center w-10">Whs</th>
            <th className="py-1 px-1 font-semibold text-center w-10">Ord</th>
            <th className="py-1 px-1 font-semibold text-center w-10">Open</th>
            <th className="py-1 px-1 font-semibold text-center w-12">Recv</th>
            <th className="py-1 px-1 font-semibold text-center w-14">On Hand</th>
            <th className="py-1 pl-1 font-semibold text-center w-14">Status</th>
          </tr>
        </thead>
        <tbody>
          {openLines.map((line) => {
            const received = receiptFor(line);
            const onHand = line.onHandAtWarehouse;
            const canPick = onHand !== null && onHand >= line.openQty && line.openQty > 0;

            return (
              <tr
                key={line.lineNum}
                className={`border-b border-border align-top ${
                  line.fromThisPo ? "bg-blue-50 print:bg-transparent" : ""
                }`}
              >
                <td className="py-1.5 pr-1 text-text-secondary">
                  {line.customerLineNo || line.lineNum + 1}
                </td>
                <td className="py-1.5 pr-2">
                  <p className="font-semibold">{line.itemCode}</p>
                  <p className="text-text-secondary leading-tight">{line.itemDescription}</p>
                  {(line.serial || line.tag || line.customerPartNo) && (
                    <p className="text-text-secondary leading-tight">
                      {[
                        line.customerPartNo && `Cust P/N ${line.customerPartNo}`,
                        line.serial && `S/N ${line.serial}`,
                        line.tag && `Tag ${line.tag}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {/* Where else the part sits, when the line's own warehouse can't cover it. */}
                  {!canPick && line.stockByWarehouse.some((w) => w.inStock > 0) && (
                    <p className="text-text-secondary leading-tight">
                      Stock:{" "}
                      {line.stockByWarehouse
                        .filter((w) => w.inStock > 0)
                        .map((w) => `${w.warehouse}=${w.inStock}`)
                        .join(", ")}
                    </p>
                  )}
                </td>
                <td className="py-1.5 px-1 text-center">{line.warehouse}</td>
                <td className="py-1.5 px-1 text-center">{line.orderedQty}</td>
                <td className="py-1.5 px-1 text-center font-semibold">{line.openQty}</td>
                <td className="py-1.5 px-1 text-center font-semibold text-success print:text-text">
                  {received ?? "—"}
                </td>
                <td className="py-1.5 px-1 text-center">
                  {onHand === null ? "?" : onHand}
                </td>
                <td className="py-1.5 pl-1 text-center">
                  {onHand === null ? (
                    <span className="text-text-secondary">—</span>
                  ) : canPick ? (
                    <span className="font-semibold text-success print:text-text">PICK</span>
                  ) : (
                    <span className="font-semibold text-error print:text-text">SHORT</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {openLines.length === 0 && (
        <p className="text-sm text-text-secondary py-4 text-center">
          Every line on SO {picklist.soNumber} is already closed.
        </p>
      )}

      {/* Footnotes */}
      <div className="mt-4 pt-2 border-t border-border text-xs text-text-secondary flex flex-col gap-1">
        {picklist.closedLineCount > 0 && (
          <p>
            {picklist.closedLineCount} closed line
            {picklist.closedLineCount !== 1 ? "s" : ""} not shown (already shipped).
          </p>
        )}
        <p>
          Highlighted rows were ordered on PO {picklist.poNumber}. On-hand is live at the
          line's warehouse and includes this receipt. PICK = enough on hand to fill the open
          quantity.
        </p>
        {picklist.soComments && <p>SO notes: {picklist.soComments}</p>}
        <div className="hidden print:flex gap-8 pt-6 text-text">
          <span>Picked by: ______________________</span>
          <span>Date: ______________</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-text-secondary">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}
