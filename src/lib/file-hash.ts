/**
 * A fingerprint for each file, so the same photo is recognisable twice.
 *
 * Two receipts of the same part, or a retried upload, can put identical bytes
 * in the warehouse under different names. Without a fingerprint nothing can
 * tell they are the same picture: storage is paid for twice, and any count of
 * "how many photos of this valve" is wrong.
 *
 * Cheap to do now, expensive to add later — the fingerprint has to be taken
 * while the file is in hand. Reading fifty thousand photos back out of storage
 * to fingerprint them afterwards costs real money and time.
 *
 * Runs in the browser using what it already has. An eight-megabyte photo takes
 * a few tens of milliseconds, and a whole receipt is well under a second.
 */

/** Lowercase hex SHA-256 of the file's bytes, or null if it cannot be taken. */
export async function fingerprint(blob: Blob): Promise<string | null> {
  try {
    // crypto.subtle needs a secure page. The app is served over https, but a
    // plain-http dev server would land here rather than throwing mid-upload.
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.warn("[fingerprint] could not fingerprint a file; it is still stored:", err);
    return null;
  }
}

/**
 * Fingerprint several files at once, keyed by whatever you use to identify
 * them. A failure on one file is null in the map, never a thrown error — a
 * missing fingerprint is a small loss, a failed receipt is not.
 */
export async function fingerprintAll<T>(
  items: T[],
  key: (item: T) => string,
  blob: (item: T) => Blob,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  await Promise.all(items.map(async (item) => { out.set(key(item), await fingerprint(blob(item))); }));
  return out;
}
