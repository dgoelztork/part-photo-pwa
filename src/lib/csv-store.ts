import Papa from "papaparse";
import { get, set } from "idb-keyval";
import type { PartRecord } from "../types";

const STORE_KEY = "part-catalog";
const META_KEY = "part-catalog-meta";

// In-memory lookup map for O(1) access
let partMap: Map<string, string> = new Map();

interface CatalogMeta {
  importedAt: string;
  count: number;
}

/** Parse CSV text and store in IndexedDB. Returns the number of parts loaded. */
export async function importCSVText(csvText: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const headers = results.meta.fields ?? [];

          // Auto-detect columns
          const partCol =
            headers.find((h) => /part.*(num|no|#|code|id)/i.test(h)) ??
            headers.find((h) => /part/i.test(h)) ??
            headers[0];

          const descCol =
            headers.find((h) => /desc/i.test(h)) ?? headers[1];

          if (!partCol || !descCol) {
            reject(
              new Error(
                "Could not detect PartNumber and Description columns in CSV"
              )
            );
            return;
          }

          const records: PartRecord[] = results.data
            .filter((row) => row[partCol]?.trim())
            .map((row) => ({
              partNumber: row[partCol].trim().toUpperCase(),
              description: row[descCol]?.trim() ?? "",
            }));

          // Store in IndexedDB
          await set(STORE_KEY, records);
          await set(META_KEY, {
            importedAt: new Date().toISOString(),
            count: records.length,
          } satisfies CatalogMeta);

          // Build in-memory map
          partMap = new Map(
            records.map((r) => [r.partNumber, r.description])
          );

          resolve(records.length);
        } catch (err) {
          reject(err);
        }
      },
      error: (err: Error) => reject(err),
    });
  });
}

/** Load catalog from IndexedDB into memory. Returns true if data exists. */
export async function loadCatalog(): Promise<boolean> {
  const records = await get<PartRecord[]>(STORE_KEY);
  if (!records || records.length === 0) return false;
  partMap = new Map(records.map((r) => [r.partNumber, r.description]));
  return true;
}

/** Look up a part number. Returns description or undefined. */
export function lookupPart(partNumber: string): string | undefined {
  return partMap.get(partNumber.toUpperCase());
}

/** Get the number of parts currently loaded in memory. */
export function getPartsCount(): number {
  return partMap.size;
}

/** Get metadata about the last import. */
export async function getCatalogMeta(): Promise<CatalogMeta | null> {
  return (await get<CatalogMeta>(META_KEY)) ?? null;
}
