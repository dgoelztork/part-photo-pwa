/**
 * Feedback storage — self-contained to this app.
 *
 * An earlier version posted into Scupper's board so there'd be one list to
 * read. Dylan wants the apps kept separate, so this owns its own data and
 * touches nothing else.
 *
 * Storage is a local SQLite file via node:sqlite (built into Node, no
 * dependency). The two obvious alternatives don't fit: the proxy's Azure SQL
 * login can write `dbo.file_cards` but is denied CREATE TABLE on `torkdata`,
 * and standing up a Postgres database needs credentials this service doesn't
 * have. Feedback is low-volume internal text, so a local file is honest and
 * survives restarts. If an Azure SQL table is created later, only this module
 * changes — the route and the UI don't care where rows live.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type FeedbackKind = "bug" | "idea";
export type FeedbackStatus = "open" | "in_progress" | "closed";

const VALID_KINDS: FeedbackKind[] = ["bug", "idea"];
const VALID_STATUSES: FeedbackStatus[] = ["open", "in_progress", "closed"];

export function isValidKind(kind: unknown): kind is FeedbackKind {
  return typeof kind === "string" && VALID_KINDS.includes(kind as FeedbackKind);
}

export function isValidStatus(status: unknown): status is FeedbackStatus {
  return typeof status === "string" && VALID_STATUSES.includes(status as FeedbackStatus);
}

/**
 * Accept only a base64 image data URL. Anything else is dropped rather than
 * stored, so the photo endpoint never has to serve what it can't decode.
 */
export function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

export interface FeedbackInput {
  kind: FeedbackKind;
  title: string;
  body?: string | null;
  page?: string | null;
  /** Submitter, from the verified token — never from the request body. */
  userEmail?: string | null;
  /** Optional photo as a data URL. */
  photoDataUrl?: string | null;
}

export interface FeedbackRow {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  page: string | null;
  status: string;
  userEmail: string | null;
  hasPhoto: boolean;
  createdAt: string;
}

let db: DatabaseSync | null = null;

function dbPath(): string {
  return process.env.FEEDBACK_DB_PATH ?? path.join(process.cwd(), "data", "feedback.db");
}

/** Open lazily and create the table on first use — no migration step to forget. */
function getDb(): DatabaseSync {
  if (db) return db;

  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);

  // WAL keeps a read (the list screen) from blocking a write (a submission).
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email  TEXT,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      page        TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      photo       TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  handle.exec("CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status, id DESC)");

  db = handle;
  console.log(`[Feedback] Store ready at ${file}`);
  return db;
}

/** Photos are large; the list never selects them, only a flag. */
const LIST_COLUMNS =
  "id, user_email, kind, title, body, page, status, created_at, " +
  "CASE WHEN photo IS NULL THEN 0 ELSE 1 END AS has_photo";

function toRow(r: Record<string, any>): FeedbackRow {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body ?? null,
    page: r.page ?? null,
    status: r.status,
    userEmail: r.user_email ?? null,
    hasPhoto: Boolean(r.has_photo),
    createdAt: r.created_at,
  };
}

export function insertFeedback(input: FeedbackInput): FeedbackRow {
  const handle = getDb();
  const result = handle
    .prepare(
      `INSERT INTO feedback (user_email, kind, title, body, page, status, photo)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(
      input.userEmail ?? null,
      input.kind,
      input.title,
      input.body ?? null,
      input.page ?? null,
      input.photoDataUrl ?? null
    );

  const row = handle
    .prepare(`SELECT ${LIST_COLUMNS} FROM feedback WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as Record<string, any>;
  return toRow(row);
}

export function listFeedback(status?: FeedbackStatus, limit = 100): FeedbackRow[] {
  const handle = getDb();
  const rows = status
    ? handle
        .prepare(`SELECT ${LIST_COLUMNS} FROM feedback WHERE status = ? ORDER BY id DESC LIMIT ?`)
        .all(status, limit)
    : handle.prepare(`SELECT ${LIST_COLUMNS} FROM feedback ORDER BY id DESC LIMIT ?`).all(limit);
  return (rows as Record<string, any>[]).map(toRow);
}

/** The stored data URL, or null when the row has no photo. */
export function getFeedbackPhoto(id: number): string | null {
  const row = getDb().prepare("SELECT photo FROM feedback WHERE id = ?").get(id) as
    | Record<string, any>
    | undefined;
  return row?.photo ?? null;
}

export function updateFeedbackStatus(id: number, status: FeedbackStatus): FeedbackRow | null {
  const handle = getDb();
  handle.prepare("UPDATE feedback SET status = ? WHERE id = ?").run(status, id);
  const row = handle.prepare(`SELECT ${LIST_COLUMNS} FROM feedback WHERE id = ?`).get(id) as
    | Record<string, any>
    | undefined;
  return row ? toRow(row) : null;
}

export function pingFeedbackStore(): {
  ok: boolean;
  message: string;
  count?: number;
  path?: string;
} {
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS n FROM feedback").get() as Record<string, any>;
    return { ok: true, message: "Feedback store ready", count: row.n, path: dbPath() };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Feedback store unavailable" };
  }
}
