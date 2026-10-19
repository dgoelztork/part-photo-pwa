/**
 * The warehouse this phone receives into, chosen once per device.
 *
 * PO lines already carry their own warehouse, and receipts follow it — every
 * Pascagoula line TFerris booked in Aug-Oct 2026 said "3". This setting only
 * fills the gaps where the app had to assume a site, and it used to assume
 * Alameda:
 *   - lines on a "Stock PO Warehouse" (S) order, or with no warehouse at all,
 *     which are shelved wherever the goods actually arrived;
 *   - the destination ZIP for freight pricing when the label doesn't show one.
 *
 * Addresses are SAP's own (OWHS), read 19 Oct 2026.
 */
export interface HomeWarehouse {
  code: string;
  name: string;
  zip: string;
}

export const HOME_WAREHOUSES: HomeWarehouse[] = [
  { code: "01", name: "Alameda", zip: "94501" },
  { code: "3", name: "Pascagoula", zip: "39581" },
];

const KEY = "receiving.homeWarehouse";
const DEFAULT = HOME_WAREHOUSES[0];

/** Alameda unless this phone has been set otherwise. Never throws: a blocked
 *  localStorage must not stop a receipt. */
export function getHomeWarehouse(): HomeWarehouse {
  try {
    const code = localStorage.getItem(KEY);
    return HOME_WAREHOUSES.find((w) => w.code === code) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setHomeWarehouse(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Best-effort: falls back to Alameda, and the receiver sees which site is
    // in use on the review screen before anything posts.
  }
}

/** The SAP warehouse a receipt line posts to. "S" only marks a stock PO; the
 *  goods are shelved where they arrived, as receipts keyed straight into SAP
 *  already do. */
export function receiptWarehouse(poLineWarehouse: string | undefined): string {
  return !poLineWarehouse || poLineWarehouse === "S" ? getHomeWarehouse().code : poLineWarehouse;
}
