/**
 * File cards — the index for every piece of evidence the warehouse captures.
 *
 * The photos themselves live elsewhere (SharePoint today, Azure Blob next).
 * This writes the *description* of each file into Azure SQL as real columns,
 * so it can be searched, counted and joined — instead of being encoded into a
 * filename like `PO35778_LINE_003_M106412_2026-08-11 14-30-00.jpg`.
 *
 * Everything here is best-effort. A failure to card a photo must never fail a
 * receipt, so callers should treat errors as non-fatal.
 */
import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function isCardsConfigured(): boolean {
  return Boolean(
    process.env.DATA_SQL_SERVER &&
      process.env.DATA_SQL_DATABASE &&
      process.env.DATA_SQL_USER &&
      process.env.DATA_SQL_PASSWORD
  );
}

/** Lazily open the pool. Never at module load — the proxy must start without the database. */
function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const config: sql.config = {
      server: process.env.DATA_SQL_SERVER!,
      database: process.env.DATA_SQL_DATABASE!,
      user: process.env.DATA_SQL_USER!,
      password: process.env.DATA_SQL_PASSWORD!,
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 20000,
      requestTimeout: 30000,
    };
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((err) => {
        // Clear the cached promise so a later call can retry rather than
        // being stuck with a permanently rejected connection.
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

export interface FileCardInput {
  /** Where the file lives, e.g. "sharepoint-receiving" or "receiving-photos". */
  container: string;
  /** Path within that store, unique together with container. */
  blobName: string;
  originalName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  /** item | nameplate | quantity | shipping-label | damage | packing-slip | document-mtr | ... */
  kind?: string | null;
  partNumber?: string | null;
  lineNum?: number | null;
  /** The SAP document this evidence belongs to — PO number for a receipt. */
  docReference?: string | null;
  description?: string | null;
  /** Clickable link to the file or its folder. */
  storageUrl?: string | null;
  /** When the photo was actually taken, ISO 8601. Falls back to now. */
  capturedAt?: string | null;
  sourceApp?: string | null;
  vesselText?: string | null;
}

export interface InsertResult {
  inserted: number;
  duplicate: number;
  failed: number;
}

const INSERT_SQL = `
INSERT INTO dbo.file_cards
  (container, blob_name, original_name, content_type, size_bytes,
   kind, part_number, line_num, doc_reference, description,
   storage_url, captured_at, captured_by, source_app, vessel_text, needs_review)
SELECT
  @container, @blobName, @originalName, @contentType, @sizeBytes,
  @kind, @partNumber, @lineNum, @docReference, @description,
  @storageUrl, @capturedAt, @capturedBy, @sourceApp, @vesselText,
  CASE WHEN @partNumber IS NULL THEN 1 ELSE 0 END
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.file_cards
  WHERE container = @container AND blob_name = @blobName
);`;

function trim(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Write one card per file. Rows already present (same container + path) are
 * skipped rather than duplicated, so a retried upload is safe.
 */
export async function insertFileCards(
  cards: FileCardInput[],
  capturedBy: string | null
): Promise<InsertResult> {
  const result: InsertResult = { inserted: 0, duplicate: 0, failed: 0 };
  if (cards.length === 0) return result;

  const pool = await getPool();

  for (const card of cards) {
    const container = trim(card.container, 80);
    const blobName = trim(card.blobName, 500);
    if (!container || !blobName) {
      result.failed++;
      continue;
    }

    let capturedAt: Date | null = null;
    if (card.capturedAt) {
      const d = new Date(card.capturedAt);
      if (!Number.isNaN(d.getTime())) capturedAt = d;
    }

    try {
      const request = pool
        .request()
        .input("container", sql.NVarChar(80), container)
        .input("blobName", sql.NVarChar(500), blobName)
        .input("originalName", sql.NVarChar(300), trim(card.originalName, 300))
        .input("contentType", sql.NVarChar(120), trim(card.contentType, 120))
        .input("sizeBytes", sql.BigInt, typeof card.sizeBytes === "number" ? card.sizeBytes : null)
        .input("kind", sql.NVarChar(60), trim(card.kind, 60))
        .input("partNumber", sql.NVarChar(50), trim(card.partNumber, 50))
        .input("lineNum", sql.Int, typeof card.lineNum === "number" ? card.lineNum : null)
        .input("docReference", sql.NVarChar(60), trim(card.docReference, 60))
        .input("description", sql.NVarChar(1000), trim(card.description, 1000))
        .input("storageUrl", sql.NVarChar(1000), trim(card.storageUrl, 1000))
        .input("capturedAt", sql.DateTime2, capturedAt ?? new Date())
        .input("capturedBy", sql.NVarChar(200), trim(capturedBy, 200))
        .input("sourceApp", sql.NVarChar(60), trim(card.sourceApp, 60) ?? "receiving-app")
        .input("vesselText", sql.NVarChar(200), trim(card.vesselText, 200));

      const res = await request.query(INSERT_SQL);
      const affected = res.rowsAffected?.[0] ?? 0;
      if (affected > 0) result.inserted++;
      else result.duplicate++;
    } catch (err) {
      result.failed++;
      console.error(
        `[FileCards] Failed to card ${container}/${blobName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return result;
}

/** Simple reachability probe used by the health route. */
export async function pingCardsDatabase(): Promise<{ ok: boolean; message: string }> {
  if (!isCardsConfigured()) {
    return { ok: false, message: "DATA_SQL_* environment variables not set" };
  }
  try {
    const pool = await getPool();
    const res = await pool.request().query("SELECT COUNT(*) AS n FROM dbo.file_cards");
    return { ok: true, message: `connected, ${res.recordset[0].n} cards on file` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
