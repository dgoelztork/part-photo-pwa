/**
 * Feedback storage — writes into Scupper's `feedback` table.
 *
 * Deliberately NOT a second feedback system. Scupper already has the board
 * Dylan reads, the status workflow and the AI triage; a receiving-only table
 * would mean a second place to check. Both apps run on TORK-APP, so the
 * receiving proxy writes into the same Postgres database Scupper owns.
 *
 * Two consequences of writing to the table rather than calling Scupper's API:
 *
 *  - Scupper's API fires a notification email (or an AI plan) from inside its
 *    request handler, and nothing re-scans the table for rows that arrived by
 *    other means. So receiving-submitted feedback appears on the board but
 *    sends no email. Wiring that up needs a service-auth path in Scupper —
 *    its API takes Azure AD bearer tokens only, with no server-to-server door.
 *  - Scupper owns this schema. If it migrates the table, this insert is what
 *    breaks. The insert names every column explicitly so a mismatch fails
 *    loudly here rather than corrupting a row.
 *
 * Rows are marked in `page` (e.g. "receiving:/labels") so the board shows at a
 * glance which app a submission came from.
 */
import { Pool } from "pg";

let pool: Pool | null = null;

export function isFeedbackConfigured(): boolean {
  return Boolean(process.env.FEEDBACK_DATABASE_URL);
}

/** Lazily open the pool — the proxy must start fine without the database. */
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.FEEDBACK_DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // A pool-level error (server restart, dropped socket) would otherwise be
    // an unhandled 'error' event and take the proxy down with it.
    pool.on("error", (err) => {
      console.error("[Feedback] Idle client error:", err.message);
    });
  }
  return pool;
}

export type FeedbackKind = "bug" | "idea";

export interface FeedbackInput {
  kind: FeedbackKind;
  title: string;
  body?: string | null;
  /** Where in the app they were, prefixed with the app name for the board. */
  page?: string | null;
  /** Submitter, taken from the verified token — never from the request body. */
  userEmail?: string | null;
  /** Optional photo as a data URL. Lands in Scupper's `screenshot` column. */
  photoDataUrl?: string | null;
}

export interface FeedbackRow {
  id: number;
  kind: string;
  title: string;
  status: string;
  createdAt: string | null;
}

/** Scupper's board renders these; anything else would be an unknown state. */
const VALID_KINDS: FeedbackKind[] = ["bug", "idea"];

export function isValidKind(kind: unknown): kind is FeedbackKind {
  return typeof kind === "string" && VALID_KINDS.includes(kind as FeedbackKind);
}

/**
 * Accept only a base64 image data URL, mirroring Scupper's own check. A photo
 * that isn't one is dropped rather than stored, so the board's image endpoint
 * never has to serve something it can't decode.
 */
export function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export async function insertFeedback(input: FeedbackInput): Promise<FeedbackRow> {
  const res = await getPool().query(
    `INSERT INTO feedback (user_email, kind, title, body, page, status, screenshot, created_at)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, now())
     RETURNING id, kind, title, status, created_at`,
    [
      input.userEmail ?? null,
      input.kind,
      input.title,
      input.body ?? null,
      input.page ?? null,
      input.photoDataUrl ?? null,
    ]
  );

  const row = res.rows[0];
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/** Confirms the proxy can reach Scupper's database. */
export async function pingFeedbackDatabase(): Promise<{ ok: boolean; message: string; count?: number }> {
  if (!isFeedbackConfigured()) {
    return { ok: false, message: "FEEDBACK_DATABASE_URL not configured on the proxy" };
  }
  try {
    const res = await getPool().query("SELECT COUNT(*)::int AS n FROM feedback");
    return { ok: true, message: "Connected to the feedback board", count: res.rows[0]?.n };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Feedback database unreachable" };
  }
}
