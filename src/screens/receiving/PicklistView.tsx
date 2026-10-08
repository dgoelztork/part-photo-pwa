import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  fetchPicklist,
  NoSalesOrderError,
  type PicklistResult,
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
  onClose,
}: {
  poNumber: string;
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

        {picklist && <PicklistDocument picklist={picklist} />}
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

/** Small print under the logo — the same block SAP's pick list and XO's order PDFs carry. */
const BRAND_TAGLINES = [
  "Marine Valve Experts (TM)",
  "US-Owned Small Business",
  "CAGE: 6VBX1",
  "DUNS: 07-862-7498",
];

const LIMITATION_OF_LIABILITY =
  "LIMITATION OF LIABILITY: UNDER NO CIRCUMSTANCES SHALL TORK SYSTEMS INC BE LIABLE TO PURCHASER FOR " +
  "INCIDENTAL, CONSEQUENTIAL OR OTHER DAMAGES IN EXCESS OF AN AMOUNT EQUAL TO THE NET CONTRACT VALUE OF THE " +
  "PRODUCTS PROVIDED BY TORK SYSTEMS TO PURCHASER WITH THIS QUOTATION UNDER OR IN CONNECTION WITH ORDERS FOR " +
  "PRODUCTS AND THESE TERMS AND CONDITIONS, WHETHER ANY CLAIM FOR RECOVERY IS BASED UPON OR ARISES OUT OF " +
  "THEORIES OF BREACH OF CONTRACT, BREACH OF WARRANTY, INDEMNIFICATION, NEGLIGENCE, TORT (INCLUDING STRICT " +
  "LIABILITY) OR OTHERWISE. FURTHERMORE, UNDER NO CIRCUMSTANCE SHALL THIS PROVISION BE MODIFIED BY ANY " +
  "CONTRARY TERM OR CONDITION CONTAINED IN ANY PURCHASER REQUEST FOR PROPOSAL, ORDER FORM, PURCHASE ORDER OR " +
  "SIMILAR DOCUMENT UNLESS NEGOTIATED, SUPPORTED BY A SEPARATE CONSIDERATION, AGREED TO IN WRITING AND SIGNED " +
  "BY BOTH PURCHASER AND TORK SYSTEMS, INC.";

/**
 * Laid out as a copy of the pick list SAP prints (sample: SO T 36679), at the
 * warehouse's request, so the phone sheet and the office sheet read the same.
 */
function PicklistDocument({ picklist }: { picklist: PicklistResult }) {
  // Closed lines have already shipped — they'd only pad the printout.
  const openLines = picklist.lines.filter((l) => !l.closed);
  const soLabel = [picklist.soSeriesPrefix, picklist.soNumber].filter(Boolean).join(" ");
  const zoom = useFitZoom(SHEET_WIDTH_PX);

  return (
    <div
      className="picklist-print mx-auto p-4 text-text text-[11px] leading-snug"
      style={{ width: SHEET_WIDTH_PX, zoom }}
    >
      {/* Header: logo + small print | PICK LIST + order numbers */}
      <div className="flex justify-between items-start gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div>
            <img
              src={`${import.meta.env.BASE_URL}tork-logo.png`}
              alt="Tork Systems"
              className="h-14 w-auto"
            />
            <p className="mt-1 text-[10px]">VISIT US AT: www.torksystems.com</p>
          </div>
          <div className="text-[8px] leading-tight pt-1">
            {BRAND_TAGLINES.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-2xl tracking-wide mb-1">PICK LIST</h1>
          <Pair label="Sales Order #:" value={soLabel} />
          <Pair label="Customer PO:" value={picklist.customerPO} />
          <Pair label="Order Date:" value={formatDate(picklist.orderDate)} />
        </div>
      </div>

      {/* Customer | Tork contact */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <Labelled label="CUSTOMER:">{picklist.customerName}</Labelled>
        <Labelled label="TORK CONTACT:">
          {[picklist.insideSales, picklist.contactEmail, picklist.contactPhone]
            .filter(Boolean)
            .map((l) => (
              <p key={l}>{l.toUpperCase()}</p>
            ))}
        </Labelled>
      </div>

      <div className="mb-3">
        <Labelled label="VESSEL/JOB:">{picklist.vesselJob}</Labelled>
      </div>

      {/* Ship to | how it ships | freight */}
      <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-3 mb-3">
        <Labelled label="SHIP TO:">
          <p>{picklist.shipToCode}</p>
          <p className="whitespace-pre-line">{picklist.shipToAddress}</p>
        </Labelled>
        <div>
          <Pair label="SHIP VIA:" value={picklist.shipVia} />
          <Pair label="SHIP SPEED:" value={picklist.shipSpeed} />
          <Pair label="FOB:" value={picklist.fob.toUpperCase()} />
        </div>
        <div>
          <Pair label="FREIGHT TERMS:" value={picklist.freightTermsCode} />
          <Pair label="ACCOUNT:" value={picklist.freightAccount} />
          <Pair label="TRACKING/POD:" value={picklist.tracking} />
        </div>
      </div>

      {/* Lines */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-text text-left">
            <th className="py-1 pr-1 font-semibold w-8">Line</th>
            <th className="py-1 pr-2 font-semibold w-24">Part Number</th>
            <th className="py-1 pr-2 font-semibold">Description</th>
            <th className="py-1 px-1 font-semibold text-right w-14">Ordered</th>
            <th className="py-1 px-1 font-semibold text-center w-10">UoM</th>
            <th className="py-1 pl-1 font-semibold text-center w-20">Shipped</th>
          </tr>
        </thead>
        <tbody>
          {openLines.map((line) => (
            <tr key={line.lineNum} className="border-b border-border align-top">
              <td className="py-1.5 pr-1">{line.lineNum + 1}</td>
              <td className="py-1.5 pr-2">{line.itemCode}</td>
              <td className="py-1.5 pr-2">
                <p className="font-semibold">{line.itemDescription}</p>
                {line.freeText && <p className="italic">Note: {line.freeText}</p>}
              </td>
              <td className="py-1.5 px-1 text-right">{line.orderedQty}</td>
              <td className="py-1.5 px-1 text-center">{line.uom}</td>
              <td className="py-1.5 pl-1 align-bottom">
                <div className="border-b border-text h-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openLines.length === 0 && (
        <p className="text-sm text-text-secondary py-4 text-center">
          Every line on SO {soLabel} is already closed.
        </p>
      )}

      {/* Important info */}
      <div className="mt-3 p-2 rounded border border-border min-h-10">
        <span className="font-semibold">Important Info: </span>
        <span className="whitespace-pre-line">{picklist.importantInfo}</span>
      </div>

      {/* Small print | received by */}
      <div className="mt-6 grid grid-cols-[2.4fr_1fr] gap-3 items-start">
        <p className="text-[6.5px] leading-tight p-2 border border-border">
          {LIMITATION_OF_LIABILITY}
        </p>
        <div className="text-[10px]">
          <p className="font-semibold mb-1">Received By</p>
          {["Name:", "Date:", "Signature:"].map((l) => (
            <div key={l} className="flex items-end gap-1 mb-1.5">
              <span className="w-14">{l}</span>
              <div className="flex-1 border-b border-text h-3" />
            </div>
          ))}
        </div>
      </div>

      {/* Company footer */}
      <div className="mt-4 text-center text-[10px] font-semibold flex flex-col gap-1">
        <p>
          TORK SYSTEMS, INC. &nbsp;|&nbsp; experts@torksystems.com &nbsp;|&nbsp; (800) 867-5514
          &nbsp;|&nbsp; www.torksystems.com
        </p>
        <p>
          TORK SYSTEMS, INC, PO Box 350117 Jacksonville, Florida 32235 &nbsp; (510) 891-9675
          &nbsp; office@torksystems.com
        </p>
      </div>
    </div>
  );
}

/**
 * The sheet is laid out at the printable width of a letter page (8.5in less
 * 0.5in margins, at 96px/in) so the screen shows exactly what prints. On a
 * phone that is wider than the screen, so it is shrunk to fit; print resets
 * the zoom (app.css).
 */
const SHEET_WIDTH_PX = 720;

function useFitZoom(width: number): number {
  const fit = () => Math.min(1, window.innerWidth / width);
  const [zoom, setZoom] = useState(fit);
  useEffect(() => {
    const onResize = () => setZoom(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  return zoom;
}

/** SAP-style "LABEL:  value" with the value block beside the label. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="font-semibold shrink-0">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="font-semibold">{label}</span> {value}
    </p>
  );
}

/**
 * SAP dates arrive as UTC midnight ("2026-09-17T00:00:00Z"). Formatting that in
 * California local time rolls it back a day, so read it as UTC.
 */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric", year: "2-digit" });
}
