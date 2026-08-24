import { Router } from "express";
import {
  blobExists,
  createUploadPermission,
  isBlobConfigured,
  safeBlobName,
} from "../services/blob-storage.js";

const router = Router();

/** A receipt is tens of photos, not thousands. */
const MAX_PER_CALL = 100;

/**
 * GET /api/blob/health
 * Says whether the warehouse is reachable and which container is in use.
 */
router.get("/health", (_req, res) => {
  res.status(isBlobConfigured() ? 200 : 503).json({
    ok: isBlobConfigured(),
    container: process.env.BLOB_RECEIVING_CONTAINER || "receiving-photos",
    message: isBlobConfigured()
      ? "blob storage is configured"
      : "AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY are not set on the proxy",
  });
});

/**
 * POST /api/blob/upload-permissions
 * Body: { container, files: [{ blobName, contentType }] }
 * Returns: { permissions: [{ url, blobName, container, expiresAt }], refused: [...] }
 *
 * Hands the browser permission to write each named file directly to Azure, so
 * eight-megabyte photos never travel through this server. Each permission is
 * write-only, single-file, and lasts fifteen minutes.
 *
 * A refusal for one file does not fail the request. The photo is in SharePoint
 * either way, and the second copy is an improvement, not a requirement — an
 * error here must never be able to interrupt somebody receiving goods.
 */
router.post("/upload-permissions", async (req, res) => {
  if (!isBlobConfigured()) {
    res.status(503).json({ error: "BLOB_UNAVAILABLE", message: "blob storage is not configured on the proxy" });
    return;
  }

  const container = String(req.body?.container ?? process.env.BLOB_RECEIVING_CONTAINER ?? "receiving-photos");
  const files = req.body?.files;
  if (!Array.isArray(files)) {
    res.status(400).json({ error: "INVALID_BODY", message: "Body must include a 'files' array" });
    return;
  }
  if (files.length > MAX_PER_CALL) {
    res.status(400).json({ error: "TOO_MANY", message: `at most ${MAX_PER_CALL} files per call` });
    return;
  }

  const permissions = [];
  const refused = [];
  for (const f of files) {
    try {
      permissions.push(createUploadPermission(container, String(f?.blobName ?? ""), f?.contentType ? String(f.contentType) : undefined));
    } catch (err) {
      refused.push({ blobName: String(f?.blobName ?? ""), reason: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ permissions, refused });
});

/**
 * GET /api/blob/exists?container=...&blobName=...
 * Did a copy actually land? Used to check after the fact rather than trusting
 * that an upload which reported success really wrote something.
 */
router.get("/exists", async (req, res) => {
  if (!isBlobConfigured()) {
    res.status(503).json({ error: "BLOB_UNAVAILABLE" });
    return;
  }
  const container = String(req.query.container ?? process.env.BLOB_RECEIVING_CONTAINER ?? "receiving-photos");
  const blobName = safeBlobName(String(req.query.blobName ?? ""));
  if (!blobName) {
    res.status(400).json({ error: "INVALID_BLOB_NAME" });
    return;
  }
  try {
    res.json({ exists: await blobExists(container, blobName), container, blobName });
  } catch (err) {
    res.status(500).json({ error: "CHECK_FAILED", message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
