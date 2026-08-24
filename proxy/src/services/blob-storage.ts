import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";

/**
 * Azure Blob — the warehouse.
 *
 * Receiving photos have always gone to SharePoint, and they still do. This puts
 * a second copy somewhere Tork owns outright. The difference matters: SharePoint
 * files are read by signing in AS A PERSON, so only the receiver who took the
 * photo can fetch it. Nothing else — no script, no report, no future tool — can
 * reach them without an administrator granting a new permission. Blob is read
 * with Tork's own credentials, so everything downstream can use it.
 *
 * The browser uploads straight to Azure rather than pushing the bytes through
 * this server. A receiving photo is often 8 megabytes and a session is a dozen
 * of them; routing that through the proxy would slow the receiver down for no
 * benefit. Instead the browser asks here for a short-lived permission to write
 * one named file, and uploads with it directly.
 *
 * That permission is WRITE ONLY, for a single blob, for fifteen minutes. It
 * cannot read, cannot list, cannot delete, and cannot touch any other file.
 */

const ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT ?? "";
const KEY = process.env.AZURE_STORAGE_KEY ?? "";

/** Containers the app may write to. Anything else is refused. */
const ALLOWED_CONTAINERS = new Set([
  process.env.BLOB_RECEIVING_CONTAINER || "receiving-photos",
  "shipcheck-photos",
]);

const SAS_MINUTES = 15;

export function isBlobConfigured(): boolean {
  return Boolean(ACCOUNT && KEY);
}

let credential: StorageSharedKeyCredential | null = null;
function getCredential(): StorageSharedKeyCredential {
  if (!credential) credential = new StorageSharedKeyCredential(ACCOUNT, KEY);
  return credential;
}

/**
 * A blob name the browser cannot use to escape its container.
 *
 * The name comes from the client, so it is treated as untrusted. Backslashes
 * become separators, empty and dot segments are dropped, and every remaining
 * segment is stripped of characters Azure rejects. What comes back is always a
 * relative path made of plain segments.
 */
export function safeBlobName(raw: string): string {
  const segments = String(raw ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 200));
  return segments.join("/").slice(0, 900);
}

export interface UploadPermission {
  url: string;
  blobName: string;
  container: string;
  expiresAt: string;
}

/**
 * Permission to write one file, for a quarter of an hour.
 *
 * `startsOn` is backdated five minutes because the receiver's phone clock and
 * Azure's clock are not the same, and a phone running a few minutes fast would
 * otherwise be refused a permission that has not started yet.
 */
export function createUploadPermission(
  container: string,
  blobName: string,
  contentType?: string,
): UploadPermission {
  if (!isBlobConfigured()) throw new Error("blob storage is not configured");
  if (!ALLOWED_CONTAINERS.has(container)) throw new Error(`refusing to write to '${container}'`);

  const name = safeBlobName(blobName);
  if (!name) throw new Error("blob name is empty after cleaning");

  const now = Date.now();
  const expiresOn = new Date(now + SAS_MINUTES * 60_000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName: name,
      permissions: BlobSASPermissions.parse("cw"), // create + write. No read, no delete, no list.
      startsOn: new Date(now - 5 * 60_000),
      expiresOn,
      protocol: SASProtocol.Https,
      contentType,
    },
    getCredential(),
  ).toString();

  return {
    url: `https://${ACCOUNT}.blob.core.windows.net/${container}/${encodeURI(name)}?${sas}`,
    blobName: name,
    container,
    expiresAt: expiresOn.toISOString(),
  };
}

/** Is the file already there? Used to skip work and to verify after the fact. */
export async function blobExists(container: string, blobName: string): Promise<boolean> {
  if (!isBlobConfigured()) return false;
  const service = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, getCredential());
  return service.getContainerClient(container).getBlockBlobClient(safeBlobName(blobName)).exists();
}

/** Read one back. For checking a copy landed, and for anything that needs the bytes later. */
export async function downloadBlob(container: string, blobName: string): Promise<Buffer> {
  if (!isBlobConfigured()) throw new Error("blob storage is not configured");
  const service = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, getCredential());
  const res = await service.getContainerClient(container).getBlockBlobClient(safeBlobName(blobName)).download();
  const chunks: Buffer[] = [];
  for await (const chunk of res.readableStreamBody ?? []) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
