/**
 * Tidy a tracking number however it arrived: barcode, the label read, or typed.
 *
 * Real numbers reached SAP's U_pFrtTracking with junk in them, and a tracking
 * number with junk in it matches nothing when someone searches for the box or
 * pastes it into a carrier's site. Seen in the receiving log, Oct 2026:
 *   1Z96302803997597<U+200B>14     zero-width space inside the number
 *   1Z92938103428534 72            a space
 *   94346508995612155367<U+200B>88 the same in a USPS number
 * plus the letter O where a zero belongs. The barcode path was already clean;
 * the label read and the typed field were not.
 *
 * Whitespace, invisible characters and dashes are always removed — no carrier
 * format uses them. O becomes 0 only where the carrier's format can only hold
 * a digit, so an LTL PRO or air waybill reference that really contains an O
 * is left alone.
 */
export function cleanTrackingNumber(raw: string): string {
  // Several numbers in one field (SAP has them a line apart, or with commas)
  // are cleaned one by one; removing the line break would weld them together.
  return raw
    .split(/[\r\n,;]+/)
    .map(cleanOne)
    .filter(Boolean)
    .join(", ");
}

function cleanOne(raw: string): string {
  const s = raw
    .normalize("NFKC")
    .replace(/[\s​-‍⁠﻿­-]/g, "")
    .toUpperCase();

  // UPS: 1Z, six-character shipper number, then ten digits (two of service,
  // seven of package, one check digit). The label read sometimes gives "IZ".
  const ups = /^[1I]Z([A-Z0-9]{6})([0-9O]{10})$/.exec(s);
  if (ups) return `1Z${ups[1]}${ups[2].replace(/O/g, "0")}`;

  // All-digit formats (FedEx 12/15/20-22, USPS 20-22, DHL 10-11): if the only
  // non-digits are O's, they were zeros.
  if (/^[0-9O]{10,22}$/.test(s) && /\d/.test(s)) return s.replace(/O/g, "0");

  return s;
}
