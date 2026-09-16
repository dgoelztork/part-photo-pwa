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
 * reach the printer without spending label stock.
 *
 * Nothing here has met a real Zebra yet. The printer became reachable on
 * 15 Sep 2026 (ZM400, USB, behind the print agent on Gabriel's PC). The first
 * test print should be judged on physical SIZE before anything else - if it is
 * not 3 x 2 inches, the resolution below is wrong and nothing else matters -
 * then on whether the barcode scans and how the vertical spacing looks.
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

/**
 * Print resolution, in dots per inch. THE most consequential number here:
 * every dimension below is derived from it, so getting it wrong does not
 * degrade the label, it prints a different label.
 *
 * The printer is a Zebra ZM400 whose installed driver reports
 * "ZDesigner ZM400 600 dpi (ZPL)", so 600 it is. It was 203 while nothing had
 * been connected - 203 is the common desktop resolution and a fair guess, but
 * the ZM400 is an industrial unit and ships in 203, 300 and 600 dpi variants.
 *
 * At 203 against a 600 dpi head, everything would have printed at a third of
 * its intended size in the top-left corner of the label, and the barcode would
 * have been too fine to scan. There is no error for this; it just comes out
 * wrong. If the first test print is the wrong physical size, suspect this line
 * before anything else - and see the calibration note in the README.
 */
const DPI = 600;

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
 * stock size OR the resolution and the logo must be regenerated, or it will sit
 * wrong and nothing will warn you. That has now happened twice: sized for 4
 * inch stock it overran the header text when the stock turned out to be 3 inch,
 * and sized for 203 dpi it was a third of its intended size on a 600 dpi head.
 *
 * Currently 307 x 130 dots, which is 0.51 x 0.22 inch: it fits between the left
 * margin at 59 and the header text at 396, with a 30 dot gap. Regenerate with:
 *
 *   proxy/tools/logo-to-zpl.ps1 -Source proxy/tools/tork-logo-source.png `
 *     -Width 307 -Height 130
 *
 * Keep the 2.36:1 aspect of the source or the mark comes out stretched; the
 * script warns if the numbers drift more than 5% from it.
 *
 * One limit worth knowing: the source image is 300 x 127 pixels, so at this
 * size it is being used at about 1:1 and cannot get crisper. It looks clean,
 * but a higher-resolution original would print better on a 600 dpi head.
 */
const LOGO_ZPL =
  `^FO${dx(MARGIN)},${dy(0.03)}^GFA,5070,5070,39,` +
  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007FFF00000000000000000000000000000000000000000000000000000000000000000000000007FFFFF0000000000000000000000000000000000000000000000000FFFFFFFFFFFFFFFFFFF0003FFFFFFF000001FFFFFFFFFFFE00000000FFFFFE00000007FFFFFF80FFFFFFFFFFFFFFFFFFF0009FFFFFFFC00001FFFFFFFFFFFFF8000000FFFFFF0000000FFFFFFF80FFFFFFFFFFFFFFFFFFF0043FFFFFFFF00001FFFFFFFFFFFFFF800000FFFFFF0000001FFFFFFF00FFFFFFFFFFFFFFFFFFF010FFFFFFFFFC0001FFFFFFFFFFFFFFE00000FFFFFF0000003FFFFFFE00FFFFFFFFFFFFFFFFFFF003FFFFFFFFFF0001FFFFFFFFFFFFFFFC0000FFFFFF0000003FFFFFFC00FFFFFFFFFFFFFFFFFFF00FFFFFFFFFFF8001FFFFFFFFFFFFFFFE0000FFFFFF0000007FFFFFF800FFFFFFFFFFFFFFFFFFF23FFFFFFFFFFFE001FFFFFFFFFFFFFFFF8000FFFFFF000000FFFFFFF800FFFFFFFFFFFFFFFFFFF87FFFFFFFFFFFF001FFFFFFFFFFFFFFFFC000FFFFFF000001FFFFFFF000FFFFFFFFFFFFFFFFFFF1FFFFFFFFFFFFF801FFFFFFFFFFFFFFFFE000FFFFFF000003FFFFFFE000FFFFFFFFFFFFFFFFFFEBFFFFFFFFFFFFFC01FFFFFFFFFFFFFFFFF000FFFFFF000007FFFFFFC000FFFFFFFFFFFFFFFFFFDFFFE0FFFFFFFFFE01FFFFFFFFFFFFFFFFF800FFFFFF00000FFFFFFF8000FFFFFFFFFFFFFFFFFFFFFF007FFFC3FFFF01FFFFFFFFFFFFFFFFFC00FFFFFF00000FFFFFFF0000FFFFFFFFFFFFFFFFFFFFFE007FFF00FFFF81FFFFFFFFFFFFFFFFFE00FFFFFF00001FFFFFFE0000FFFFFFFFFFFFFFFFFFFFF8003FFF003FFFC1FFFFFFFFFFFFFFFFFF00FFFFFF00003FFFFFFC0000FFFFFFFFFFFFFFFFFFFFF0003FFE001FFFE1FFFFFFFFFFFFFFFFFF00FFFFFF00007FFFFFFC0000FFFFFFFFFFFFFFFFFFFFC0001FFE000FFFF1FFFFFFFFFFFFFFFFFF80FFFFFF0000FFFFFFF80000FFFFFFFFFFFFFFFFFFFF80001FFE0003FFF9FFFFFFFFFFFFFFFFFF80FFFFFF0001FFFFFFF00000FFFFFFFFFFFFFFFFFFFF00001FFE0001FFF9FFFFFFFFFFFFFFFFFFC0FFFFFF0003FFFFFFE00000FFFFFFFFFFFFFFFFFFFE00001FFE0000FFFDFFFFFFFFFFFFFFFFFFC0FFFFFF0003FFFFFFC00000FFFFFFFFFFFFFFFFFFFC00001FFE00007FFFFFFFFFFFFFFFFFFFFFC0FFFFFF0007FFFFFF800000FFFFFFFFFFFFFFFFFFF800001FFE00003FFFFFFFFFFFFFFFFFFFFFE0FFFFFF000FFFFFFF0000007FFFFF7FFFFFEFE1FFF800001FFC00001FFFFFFFFE00003FFFFFFFE0FFFFFF001FFFFFFE0000000000003FFFFFC000FFF000001FFC00001FFFFFFFFE000003FFFFFFE0FFFFFF003FFFFFFC0000000000003FFFFFC000FFE000001FFC00000FFFFFFFFE000000FFFFFFE0FFFFFF007FFFFFFC0000000000003FFFFFC001FFE000003FFC000007FFFFFFFE0000007FFFFFF0FFFFFF007FFFFFF80000000000003FFFFFC001FFC000003FFC000007FFFFFFFE0000003FFFFFF0FFFFFF00FFFFFFF00000000000003FFFFFC003FF8000003FFC000003FFFFFFFE0000003FFFFFF0FFFFFF01FFFFFFE00000000000003FFFFFC003FF8000003FFC000003FFFFFFFE0000001FFFFFF0FFFFFF03FFFFFFC00000000000003FFFFFC007FF8000007FFE000001FFFFFFFE0000001FFFFFF0FFFFFF07FFFFFF800000000000003FFFFFC007FF000000FFFE000001FFFFFFFE0000001FFFFFF0FFFFFF0FFFFFFF000000000000003FFFFFC007FF000001FFFF000000FFFFFFFE0000001FFFFFF0FFFFFF1FFFFFFE000000000000003FFFFFC00FFE000003FFFF800000FFFFFFFE0000001FFFFFF0FFFFFF1FFFFFFE000000000000003FFFFFC00FFE000007FFFFC00000FFFFFFFE0000001FFFFFF0FFFFFF3FFFFFFC000000000000003FFFFFC00FFE000007FFFFE00000FFFFFFFE0000001FFFFFF0FFFFFF7FFFFFF8000000000000003FFFFFC00FFE00000FFFFFE000007FFFFFFE0000001FFFFFF0FFFFFFFFFFFFF0000000000000003FFFFFC01FFC00001FFFFFF000007FFFFFFE0000001FFFFFF0FFFFFFFFFFFFE0000000000000003FFFFFC01FFC00001FF3FFF000007FFFFFFE0000003FFFFFE0FFFFFFFFFFFFC0000000000000003FFFFFC01FFC00003FFFFFF800007FFFFFFE0000003FFFFFE0FFFFFFFFFFFF80000000000000003FFFFFC01FFC00003FF01FF800007FFFFFFE0000007FFFFFE0FFFFFFFFFFFFC0000000000000003FFFFFC01FFC00003FF00FF800003FFFFFFE000001FFFFFFE0FFFFFFFFFFFFE0000000000000003FFFFFC01FFC00003FF00FFC00003FFFFFFE000007FFFFFFC0FFFFFFFFFFFFE0000000000000003FFFFFC01FFC00007FF00FFC00003FFFFFFF00007FFFFFFFC0FFFFFFFFFFFFF0000000000000003FFFFFC01FFC0000FFF00FFC00003FFFFFFFFFFFFFFFFFFF80FFFFFFFFFFFFF8000000000000003FFFFFC01FFC0001FFF00FFE00003FFFFFFFFFFFFFFFFFFF80FFFFFFFFFFFFF8000000000000003FFFFFC01FFE0007FFF00FFF00003FFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFFFC000000000000003FFFFFC01FFE001FFFFFFFFF80007FFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFFFE000000000000003FFFFFC01FFF007FFFFFFFFFC0007FFFFFFFFFFFFFFFFFFE00FFFFFFFFFFFFFE000000000000003FFFFFC01FFF81FFFFFFFFFFF0007FFFFFFFFFFFFFFFFFFC00FFFFFFFFFFFFFF000000000000003FFFFFC01FFFFFFFFFFFFFFFF8007FFFFFFFFFFFFFFFFFFC00FFFFFFFFFFFFFF800000000000003FFFFFC01FFFFFFFFFFFFFFFFE01FFFFFFFFFFFFFFFFFFF800FFFFFFFFFFFFFFC00000000000003FFFFFC00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000FFFFFFFFFFFFFFC00000000000003FFFFFC00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE000FFFFFFFFFFFFFFE00000000000003FFFFFC00FFFFFFFB7FFFFFFFFFFFFFFFFFFFFFFFFFFFF8000FFFFFFFFFFFFFFF00000000000003FFFFFC00FFFFFFE103FF8FFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFFFFFFFFF00000000000003FFFFFC007FFFFF84000003FFFFFFFFFFFFFFFFFFFFFFE0000FFFFFFFFFFFFFFF80000000000003FFFFFC007FFFFE10000001FFFFFFFFFFFFFFFFFFFFFF80000FFFFFFFF7FFFFFFC0000000000003FFFFFC007FFFFC400000007FFFFFFFFFFFFFFFFFFFFE00000FFFFFFFE7FFFFFFC0000000000003FFFFFC007FFFFE000000003FFFFFFFFFFFFFFFFFFFFE00000FFFFFFFC3FFFFFFE0000000000003FFFFFC003FFFFE000000000FFFFFFFFFFFFFFFFFFFFF00000FFFFFFF81FFFFFFF0000000000003FFFFFC003FFFFE0000000007FFFFFFFFFFFFFFFFFFFF00000FFFFFFF01FFFFFFF0000000000003FFFFFC001FFFFC0000000001FFFFFFFFFFFFFFFFFFFF80000FFFFFFE00FFFFFFF8000000000003FFFFFC001FFFF80000000001FFFFFFFFFFE003FFFFFFC0000FFFFFFC007FFFFFFC000000000003FFFFFC000FFFF80000000000FFFFFFFFFFE001FFFFFFC0000FFFFFF8007FFFFFFC000000000003FFFFFC000FFFF00000000000FFFFFFFFFFE001FFFFFFE0000FFFFFF8003FFFFFFE000000000003FFFFFC0007FFF000000000007FFFFFFFFFE000FFFFFFF0000FFFFFF0001FFFFFFF000000000003FFFFFC0007FFF800000000007FFFFFFFFFE0007FFFFFF0000FFFFFF0001FFFFFFF800000000003FFFFFC0003FFF80000000000FFFFDFFFFFE0007FFFFFF8000FFFFFF0000FFFFFFF800000000003FFFFFC0003FFFC0000000000FFFF9FFFFFE0003FFFFFFC000FFFFFF00007FFFFFFC00000000003FFFFFC0001FFFE0000000001EFFF9FFFFFE0001FFFFFFC000FFFFFF00007FFFFFFE00000000003FFFFFC0000FFFF00000000015FFF1FFFFFE0001FFFFFFE000FFFFFF00003FFFFFFE00000000003FFFFFC00007FFFC0000000023FFE1FFFFFE0000FFFFFFF000FFFFFF00001FFFFFFF00000000003FFFFFC00003FFFE0000000007FFC1FFFFFE00007FFFFFF000FFFFFF00000FFFFFFF80000000003FFFFFC00003FFFF800000031FFF81FFFFFE00007FFFFFF800FFFFFF00000FFFFFFF80000000003FFFFFC00001FFFFF00000183FFF01FFFFFE00003FFFFFFC00FFFFFF000007FFFFFFC0000000003FFFFFC00000FFFFFE000020FFFF01FFFFFE00001FFFFFFC00FFFFFF000003FFFFFFE0000000003FFFFFC000007FFFFFE003C3FFFC01FFFFFE00001FFFFFFE00FFFFFF000003FFFFFFE0000000003FFFFFC000003FFFFFFFFFFFFFF801FFFFFE00000FFFFFFF00FFFFFF000001FFFFFFF0000000003FFFFFC000001FFFFFFFFFFFFFF001FFFFFE000007FFFFFF80FFFFFF000000FFFFFFF8000000003FFFFFC0000007FFFFFFFFFFFFE001FFFFFE000007FFFFFF80FFFFFF000000FFFFFFF8000000003FFFFFC0000003FFFFFFFFFFFFC001FFFFFE000003FFFFFFC0FFFFFF0000007FFFFFFC000000003FFFFFC0000000FFFFFFFFFFFF8001FFFFFE000001FFFFFFE0FFFFFF0000003FFFFFFE000000003FFFFFC00000007FFFFFFFFFFE0001FFFFFE000001FFFFFFE0FFFFFF0000003FFFFFFF000000003FFFFFC00000001FFFFFFFFFF80001FFFFFE000000FFFFFFF0FFFFFF0000001FFFFFFF000000003FFFFFC000000007FFFFFFFFE00001FFFFFE0000007FFFFFF8FFFFFF0000000FFFFFFF800000003FFFFFC000000000FFFFFFFF800001FFFFFE0000007FFFFFF8FFFFFF0000000FFFFFFFC00000003FFFFFC0000000003FFFFFFC000001FFFFFE0000003FFFFFFCFFFFFF00000007FFFFFFC00000003FFFFFC00000000007FFFFC0000001FFFFFE0000001FFFFFFCFFFFFE00000003FFFFFFC00000000000000000000000003FF00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000FFFE00003C00003C00003FFF00000FFFFFF8000FFFFF80001F8000007E000001FFF80000000007FFFFC0003E00007C0001FFFFE0000FFFFFF8000FFFFFC0001FC00000FF00001FFFFF000000000FFFFFC0001F0000F80003FFFFF0000FFFFFF8000FFFFF80001FE00000FF00003FFFFF800000000F0003E0000F8001F00007C000F8000003E000000F000000001FE00001FF00003C0007800000001E0001E00007C003E00007800078000001E000000F000000001EF00003EF0000780007C00000001E0001F00003E007C0000F000078000001E000000F000000001EF80003CF0000780003C00000001E0000E00001F00F80000F000078000001E000000F000000001E780007CF0000780003800000001E0000000000F81F00000F000000000001E000000F000000001E7C00078F0000780000000000001E00000000007C3E000007800000000001E000000F000000001E3E000F0F0000780000000000000F00000000003E7C000007C00000000001E000000F000000001E1E001F0F00003E0000000000000FFFF80000001FF8000003FFFE00000001E000000FFFFF80001E1F001E0F00003FFFE00000000007FFFFC000000FF0000001FFFFE0000001E000000FFFFF80001E0F003E0F00000FFFFF0000000000FFFFE0000007E00000003FFFF8000001E000000FFFFF00001E07803C0F000003FFFF80000000000003F0000003C00000000001F8000001E000000F000000001E07C0780F000000000FC0000000000000F0000003C000000000007C000001E000000F000000001E03C0F80F0000000003C0000000000000F0000003C000000000003C000001E000000F000000001E03E0F00F0000000003C00000001C0000F0000003C000000F00003C000001E000000F000000001E01E1F00F0000780001C00000001E0000F0000003C000000F00003C000001E000000F000000001E00F1E00F0000780003C00000001E0000F0000003C000000F00003C000001E000000F000000001E00FBC00F0000780003C00000001E0000F0000003C000000F800078000001E000000F000000001E007FC00F0000780003C00000001F0001E0000003C0000007C000F8000001E000000F000000001E003F800F00007C0007C00000000FFFFFE0000003C0000003FFFFF0000001E000000FFFFFC0001E003F000F00003FFFFF8000000007FFFF80000003C0000001FFFFE0000001E000000FFFFFC0001E001F000F00000FFFFF00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
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

/**
 * A character advances a little under half its height in this font.
 *
 * Measured off the first real print rather than taken from a specification:
 * 41 characters filled 1682 dots at height 84. Font 0 is proportional, so this
 * is an average and nothing here should depend on it being exact.
 */
const CHAR_ADVANCE = 0.49;

/**
 * Would this text fit in `lines` lines, wrapping on spaces the way ^FB does?
 *
 * Counting characters against a budget is not good enough: greedy wrapping
 * leaves a ragged gap at the end of each line, so text well inside a character
 * budget can still need an extra line. Simulating the wrap catches that, which
 * matters because ^FB clips the overflow silently and real part descriptions
 * carry their identifying numbers at the END - exactly what gets lost.
 *
 * A single word longer than a line counts as not fitting. ^FB would in fact
 * break it, but a description with a word that long wants a smaller font.
 */
function wrapsWithin(text: string, charsPerLine: number, lines: number): boolean {
  if (charsPerLine < 1) return false;
  let used = 1;
  let filled = 0;
  for (const word of text.split(" ")) {
    if (word.length > charsPerLine) return false;
    const need = filled === 0 ? word.length : filled + 1 + word.length;
    if (need <= charsPerLine) {
      filled = need;
    } else {
      used++;
      filled = word.length;
      if (used > lines) return false;
    }
  }
  return true;
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

  // Centred description over two lines, in a block narrower than the label.
  //
  // The width is what decides where the text breaks, and the sample breaks it
  // evenly - "1/2 BRZ 200/400 SB RETAINER RING" then "5346-100 MIL-F-1183".
  // A full-width block fits more on the first line and leaves a stub on the
  // second, which is why the first real print did not match the sample.
  //
  // The narrower block costs capacity, and ^FB CLIPS what will not fit rather
  // than shrinking it. Measured against the live catalogue: of 67,175 active
  // parts the average description is 43 characters, but 7% exceed 68 and the
  // longest is 200. Clipping one label in fourteen is not acceptable on
  // something that goes to a customer, so the font steps down instead.
  //
  // CHAR_ADVANCE comes from the first real print rather than a specification:
  // 41 characters of this font filled 1682 dots at height 84, so a character
  // advances a little under half its height. It is an estimate, which is why
  // the step-down threshold is deliberately conservative.
  // The narrow block is tried first because it reproduces the sample. When a
  // description will not fit, widening comes before shrinking - a wider block
  // costs only the resemblance, whereas a smaller font costs legibility on a
  // label read at arm's length in a warehouse.
  const DESC_LINES = 2;
  const narrowWidth = Math.round(PW * 0.78);
  const ladder = [
    { width: narrowWidth, size: fs(0.07) },
    { width: contentWidth, size: fs(0.07) },
    { width: contentWidth, size: fs(0.057) },
    { width: contentWidth, size: fs(0.048) },
  ];

  const perLine = (width: number, size: number) => Math.floor(width / (CHAR_ADVANCE * size));
  const chosen = ladder.find((o) => wrapsWithin(description, perLine(o.width, o.size), DESC_LINES)) ??
    ladder[ladder.length - 1];

  // Only reached by descriptions longer than about 118 characters, which is
  // 0.3% of the catalogue. Truncating on a whole character is at least
  // predictable, where ^FB would silently clip mid-glyph.
  const descCap = perLine(chosen.width, chosen.size) * DESC_LINES;
  const descText =
    description.length <= descCap ? description : escapeZpl(fields.itemDescription, descCap);
  const descLeft = Math.round((PW - chosen.width) / 2);

  const descBlock =
    `^FO${descLeft},${dy(0.195)}^A0N,${chosen.size},${chosen.size}` +
    `^FB${chosen.width},${DESC_LINES},4,C,0^FD${descText}^FS`;

  // Code 128 of the customer PO, with no interpretation line: the sample
  // prints none under the bars, because the number appears as text on the row
  // below. Skipped entirely when there is no PO, since an empty ^FD gives the
  // encoder nothing to work with.
  //
  // ^BY's module width is in DOTS, so unlike everything else here it does not
  // follow from the label size - it follows from the resolution. A scanner
  // needs a narrow bar of roughly 0.01 inch; that is 2 dots at 203 dpi and 6 at
  // 600. Leaving it at 2 on this printer would have produced bars a third of
  // the width a scanner can resolve, which fails silently: the label looks
  // right to a person and simply will not read.
  // Code 128 also wants a quiet zone: clear space to the left of the first bar
  // of at least ten narrow bars. The shared margin gives 59 dots against a
  // 60 dot requirement - a single dot under, which is the sort of thing that
  // reads fine on one scanner and intermittently on another. The first printed
  // label did scan, so this is insurance rather than a repair. Eleven modules
  // rather than the bare ten, since the cost is 0.01 inch of label.
  const barModule = Math.max(2, Math.round(DPI * 0.01));
  const barLeft = Math.max(dx(MARGIN), barModule * 11);
  const barHeight = fs(0.145);
  const barcode = customerPO
    ? `^BY${barModule},3,${barHeight}^FO${barLeft},${dy(0.365)}^BCN,${barHeight},N,N,N^FD${customerPO}^FS`
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
