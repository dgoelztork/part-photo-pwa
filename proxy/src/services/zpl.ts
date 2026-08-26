/**
 * ZPL generation for item labels.
 *
 * ============================ PROVISIONAL ============================
 * This layout is a placeholder. Dylan is supplying a sample of the item
 * label Tork already uses, and the real one should replace `buildItemLabel`
 * below. Everything else — the sales-order lookup, the print route, the
 * screen — is layout-agnostic, so swapping this function is the whole job.
 *
 * Do not run production stock through this until it has been matched to the
 * sample and test-printed. Two things are guesses until then: the label
 * dimensions (assumed 4" x 2" at 203 dpi) and which fields the warehouse
 * actually wants.
 * =====================================================================
 *
 * ZPL basics used here:
 *   ^XA / ^XZ   start / end of a label format
 *   ^PW / ^LL   print width / label length, in dots
 *   ^FO x,y     field origin
 *   ^A0N,h,w    scalable font, normal orientation, height/width in dots
 *   ^BY / ^BCN  barcode defaults / Code 128
 *   ^FD ... ^FS field data / field separator
 *   ^PQn        print quantity — n copies of this label
 */

/** 203 dpi is the common Zebra desktop resolution: 8 dots per mm, 203 per inch. */
const DPI = 203;
const LABEL_WIDTH_IN = 4;
const LABEL_HEIGHT_IN = 2;
const PW = LABEL_WIDTH_IN * DPI; // 812
const LL = LABEL_HEIGHT_IN * DPI; // 406

export interface ItemLabelFields {
  itemCode: string;
  itemDescription: string;
  /** Piece quantity on the sales-order line — printed for reference. */
  orderedQty?: number | null;
  soNumber?: number | string | null;
  customerName?: string | null;
  customerPartNo?: string | null;
  warehouse?: string | null;
  /** How many copies of this label to print. */
  copies: number;
}

/**
 * Make text safe to drop inside a ^FD field.
 *
 * ZPL treats ^ and ~ as command prefixes, so a caret inside field data can
 * silently truncate the label or emit garbage. Item descriptions here are
 * free text from SAP and do contain punctuation, so strip the control
 * characters rather than trusting the data.
 */
export function escapeZpl(value: unknown, maxLength = 64): string {
  return String(value ?? "")
    .replace(/[\^~]/g, " ")
    // Drop control characters, which the printer would interpret or ignore.
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Clamp copies to something a fat-fingered entry can't turn into 900 labels. */
export const MAX_COPIES = 200;

export function normalizeCopies(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_COPIES);
}

/**
 * Build the ZPL for one item label.
 *
 * Layout (provisional), 4" x 2":
 *   part number, large, top-left
 *   description, wrapped to two lines beneath
 *   qty + warehouse on the left, SO + customer on the right
 *   Code 128 barcode of the part number across the bottom, human-readable
 */
export function buildItemLabel(fields: ItemLabelFields): string {
  const copies = normalizeCopies(fields.copies);
  const itemCode = escapeZpl(fields.itemCode, 32);
  const description = escapeZpl(fields.itemDescription, 90);

  // ^FB wraps long text into a block: width, max lines, line spacing.
  const descBlock = `^FO20,70^A0N,24,24^FB${PW - 40},2,4,L,0^FD${description}^FS`;

  const qty =
    fields.orderedQty === null || fields.orderedQty === undefined
      ? ""
      : `^FO20,150^A0N,26,26^FDQTY: ${escapeZpl(fields.orderedQty, 12)}^FS`;

  const warehouse = fields.warehouse
    ? `^FO150,150^A0N,26,26^FDWHS: ${escapeZpl(fields.warehouse, 8)}^FS`
    : "";

  const so = fields.soNumber
    ? `^FO320,150^A0N,26,26^FDSO: ${escapeZpl(fields.soNumber, 16)}^FS`
    : "";

  const customer = fields.customerName
    ? `^FO20,182^A0N,22,22^FB${PW - 40},1,0,L,0^FD${escapeZpl(fields.customerName, 40)}^FS`
    : "";

  const custPart = fields.customerPartNo
    ? `^FO320,182^A0N,22,22^FDCUST P/N: ${escapeZpl(fields.customerPartNo, 24)}^FS`
    : "";

  // Code 128 auto-selects its subset, so an alphanumeric part number like
  // M106412 encodes without us picking a character set.
  const barcode = `^BY2,3,70^FO20,220^BCN,70,Y,N,N^FD${itemCode}^FS`;

  return [
    "^XA",
    `^PW${PW}`,
    `^LL${LL}`,
    "^LH0,0",
    // Part number — the thing a picker reads from a distance.
    `^FO20,20^A0N,42,42^FD${itemCode}^FS`,
    descBlock,
    qty,
    warehouse,
    so,
    customer,
    custPart,
    barcode,
    `^PQ${copies}`,
    "^XZ",
  ]
    .filter(Boolean)
    .join("\n");
}
