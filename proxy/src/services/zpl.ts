/**
 * ZPL generation for item labels.
 *
 * Matched to the label Tork already prints from SAP. Dylan supplied samples
 * from SO 36405 (RIX INDUSTRIES) on 9 Sep 2026, and confirmed the one thing
 * the images alone could not settle: the barcode encodes the CUSTOMER PO.
 *
 * The stock is 2x3: 3 inches wide by 2 tall. It was first reported as 2x4 and
 * corrected the same day, so treat any older note saying 4 inches as wrong.
 *
 * The logo is the black wordmark from torksystems.com, converted to a one-bit
 * bitmap by proxy/tools/logo-to-zpl.ps1 and embedded below.
 *
 * `/api/labels/preview` runs this same builder, so it shows exactly what would
 * reach the printer without spending label stock. Nothing here has been put in
 * front of a real Zebra yet: the vertical spacing and the barcode height are
 * the two things a first test print should be checked against.
 *
 * ZPL basics used here:
 *   ^XA / ^XZ   start / end of a label format
 *   ^PW / ^LL   print width / label length, in dots
 *   ^FO x,y     field origin
 *   ^A0N,h,w    scalable font, normal orientation, height/width in dots
 *   ^FB w,n,g,j block of text: width, max lines, line gap, justification
 *   ^BY / ^BCN  barcode defaults / Code 128
 *   ^FD ... ^FS field data / field separator
 *   ^PQn        print quantity, meaning n copies of this label
 */

/** 203 dpi is the common Zebra desktop resolution: 8 dots per mm, 203 per inch. */
const DPI = 203;

/**
 * Stock size: 2x3, printing 3 inches wide by 2 inches tall. Corrected on
 * 9 Sep 2026, having first been reported as 2x4.
 *
 * This is the better fit for the evidence, not just the later answer. The
 * sample images are proportionally about 1.64 to 1; 3x2 is 1.5 to 1, whereas
 * 4x2 would have been 2 to 1. The remaining difference is almost certainly the
 * page margins around the label in the screenshots rather than its true edges.
 *
 * Every position below is a fraction of these two numbers, so a further change
 * of stock is a two-number change - with ONE exception, the logo, which is a
 * fixed bitmap and has to be regenerated. See LOGO_ZPL.
 */
const LABEL_WIDTH_IN = 3;
const LABEL_HEIGHT_IN = 2;
const PW = Math.round(LABEL_WIDTH_IN * DPI);
const LL = Math.round(LABEL_HEIGHT_IN * DPI);

/**
 * Positions and text sizes are fractions of the label rather than fixed dot
 * offsets, so a change of stock does not mean re-measuring the whole layout.
 */
const dx = (frac: number) => Math.round(PW * frac);
const dy = (frac: number) => Math.round(LL * frac);
const fs = (frac: number) => Math.round(LL * frac);

/** Left and right margin, shared by every row. */
const MARGIN = 0.033;

/**
 * The Tork logo, as a one-bit bitmap.
 *
 * A thermal head burns a dot or it does not: no grey, no colour. So the mark
 * cannot be handed over as a PNG - it is embedded here as ^GFA hex at exactly
 * the dot size it occupies. Embedding rather than storing it in printer
 * memory keeps this self-contained, which matters because the machine hosting
 * the print agent can be swapped without anyone re-provisioning the printer.
 *
 * The red wheel comes out solid black. That is unavoidable, and worth knowing
 * before anyone holds a label against the colour sample from SAP.
 *
 * WATCH OUT: this is the one measurement here that does NOT rescale with the
 * label. Every other position is a fraction; this is fixed pixels. Change the
 * stock size and the logo must be regenerated, or it will sit wrong and
 * nothing will warn you. This already happened once: sized for 4 inch stock,
 * it overran into the header text when the real stock turned out to be 3 inch.
 *
 * Currently 104 x 44 dots, which fits between the left margin at 20 and the
 * header text at 134, with a 10 dot gap. Regenerate with:
 *
 *   proxy/tools/logo-to-zpl.ps1 -Source proxy/tools/tork-logo-source.png `
 *     -Width 104 -Height 44
 *
 * Keep the 2.36:1 aspect of the source or the mark comes out stretched; the
 * script warns if the numbers drift more than 5% from it.
 */
const LOGO_ZPL =
  `^FO${dx(MARGIN)},${dy(0.03)}^GFA,572,572,13,` +
  "0000000000000000000000000000000000000000000000000000FFFFFFC1FF80FFFFE00FF007FEFFFFFFC7FFE0FFFFFC0FF007FEFFFFFFDFFFF8FFFFFE0FF00FFCFFFFFFBEFFFCFFFFFF0FF01FF8FFFFFF787C7EFFFFFF8FF03FF0FFFFFFF0783EFFFFFFCFF07FE0FFFFFFE0781FFFFFFFCFF0FFC000FF83C0780FFF80FFCFF0FF80007F83807807FF807FCFF1FF00007F87807803FF803FEFF3FE00007F8700FC03FF803FEFF7FE00007F8F01FE03FF803FCFFFFC00007F8F01DE01FF803FCFFFF800007F8F03CF01FF80FFCFFFF800007F8F03CF01FFFFFFCFFFFC00007F8F0FFF81FFFFFF8FFFFE00007F8FFFFFE3FFFFFF0FFFFE00007F8FFFFFFFFFFFFE0FFFFF00007F87F801FFFFFFFC0FFFFF80007F87F000FFFFFFF80FFDFF80007F87E0007FFFFFF80FF8FFC0007F83E0003FFF87FC0FF07FE0007F83F0002FFF87FE0FF07FE0007F81F8001EFF83FF0FF03FF0007F80FC003EFF81FF0FF01FF8007F807F80FCFF81FF8FF01FF8007F803FFFF0FF80FFCFF00FFC007F801FFFE0FF807FCFF007FE007F8007FF80FF807FEFF007FF00000000FC0040000000000000000C000001E000404000000038007F818207F83FC1FE0703C1FE006080C404080201800703C1830060006C06000201800586C180003F803803F80201FE04C4C0FE0000C0300008020180044CC0030040C03004080201800478C183007B803007380201FE0430C1EF001F000001E000007C0000007C000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "^FS";

export interface ItemLabelFields {
  /** SAP item code, printed as "Tork Part". */
  itemCode: string;
  /** SAP item description, centred and wrapped to two lines. */
  itemDescription: string;
  /** Sales order number, printed as "Tork SO". */
  soNumber?: number | string | null;
  /**
   * The customer's PO number, from the order header (NumAtCard). This is both
   * the barcode and the "PO:" text. It is NOT the "Bar Code" field SAP keeps
   * on each line, which holds an unrelated number such as 605346.100.
   */
  customerPO?: string | null;
  /** The customer's own line reference (U_CustomerLineNo), e.g. 31-B6026. */
  customerLineNo?: string | null;
  /**
   * Vessel name / job number from the order header. The existing label prints
   * this under the heading "Cust Part:", which reads oddly, since on Navy work
   * it is a contract number. It is what the label has always shown.
   */
  vesselJob?: string | null;
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
 * Layout, matching the sample:
 *
 *   [logo]              (510) 891-9675 | sales@torksystems.com
 *                       Tork Part: M113649 | Tork SO: 36405
 *            1/2 BRZ 200/400 SB RETAINER RING
 *                  5346-100 MIL-F-1183
 *   |||||||||| barcode of the customer PO ||||||||||
 *   PO:  P000043749   Line: 31-B6026
 *
 *   Cust Part:
 *            N00024-23-C-2307
 *
 * Note what is deliberately absent: quantity. The sample prints none, even on
 * a line for 50 pieces. Quantity only decides how many copies come out.
 */
export function buildItemLabel(fields: ItemLabelFields): string {
  const copies = normalizeCopies(fields.copies);
  const itemCode = escapeZpl(fields.itemCode, 32);
  const description = escapeZpl(fields.itemDescription, 90);
  const customerPO = escapeZpl(fields.customerPO, 32);
  const customerLineNo = escapeZpl(fields.customerLineNo, 24);
  const vesselJob = escapeZpl(fields.vesselJob, 40);
  const soNumber = escapeZpl(fields.soNumber, 16);

  const contentWidth = PW - 2 * dx(MARGIN);

  // Two right-aligned header lines. ^FB right-justifies within its own block,
  // so the block runs from clear of the logo across to the right margin.
  //
  // The font is deliberately smaller than the body text. On this 3 inch stock
  // the block is about 455 dots wide, and the longest line - the phone number
  // and address together - is close to filling it. ^FB with a one line limit
  // CLIPS rather than shrinking, so the headroom is on purpose. Reducing the
  // label width further, or lengthening that address, needs a check here.
  const headerLeft = dx(0.22);
  const headerWidth = PW - headerLeft - dx(MARGIN);
  const headerSize = fs(0.048);
  const contact =
    `^FO${headerLeft},${dy(0.055)}^A0N,${headerSize},${headerSize}` +
    `^FB${headerWidth},1,0,R,0^FD(510) 891-9675 | sales@torksystems.com^FS`;
  const identity =
    `^FO${headerLeft},${dy(0.125)}^A0N,${headerSize},${headerSize}` +
    `^FB${headerWidth},1,0,R,0^FDTork Part: ${itemCode} | Tork SO: ${soNumber}^FS`;

  // Centred description, wrapping to two lines.
  const descSize = fs(0.07);
  const descBlock =
    `^FO${dx(MARGIN)},${dy(0.195)}^A0N,${descSize},${descSize}` +
    `^FB${contentWidth},2,4,C,0^FD${description}^FS`;

  // Code 128 of the customer PO, with no interpretation line: the sample
  // prints none under the bars, because the number appears as text on the row
  // below. Skipped entirely when there is no PO, since an empty ^FD gives the
  // encoder nothing to work with.
  const barHeight = fs(0.145);
  const barcode = customerPO
    ? `^BY2,3,${barHeight}^FO${dx(MARGIN)},${dy(0.365)}^BCN,${barHeight},N,N,N^FD${customerPO}^FS`
    : "";

  const bodySize = fs(0.065);

  // "Line:" prints with nothing after it when a line carries no customer
  // reference. That is exactly what the sample does on its MTR rows.
  const poRow =
    `^FO${dx(MARGIN)},${dy(0.555)}^A0N,${bodySize},${bodySize}` +
    `^FB${contentWidth},1,0,L,0^FDPO:  ${customerPO}   Line: ${customerLineNo}^FS`;

  const custPartLabel =
    `^FO${dx(MARGIN)},${dy(0.76)}^A0N,${bodySize},${bodySize}^FDCust Part:^FS`;
  const custPartValue = vesselJob
    ? `^FO${dx(0.3)},${dy(0.85)}^A0N,${bodySize},${bodySize}` +
      `^FB${PW - dx(0.3) - dx(MARGIN)},1,0,L,0^FD${vesselJob}^FS`
    : "";

  return [
    "^XA",
    `^PW${PW}`,
    `^LL${LL}`,
    "^LH0,0",
    LOGO_ZPL,
    contact,
    identity,
    descBlock,
    barcode,
    poRow,
    custPartLabel,
    custPartValue,
    `^PQ${copies}`,
    "^XZ",
  ]
    .filter(Boolean)
    .join("\n");
}
