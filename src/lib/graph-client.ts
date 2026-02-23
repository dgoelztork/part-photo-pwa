import { getAccessToken } from "./auth";
import { GRAPH_BASE_URL } from "../config";

async function graphFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Graph API error (${response.status}): ${errorText}`
    );
  }

  return response;
}

/** Download a file from OneDrive by path. Returns the raw text content. */
export async function downloadFile(filePath: string): Promise<string> {
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "/");
  const response = await graphFetch(
    `/me/drive/root:${encodedPath}:/content`
  );
  return response.text();
}

/** Upload a file to OneDrive. For files < 4MB, uses simple upload. */
export async function uploadFile(
  folderPath: string,
  fileName: string,
  blob: Blob,
  contentType: string = "image/jpeg"
): Promise<void> {
  const encodedFolder = encodeURIComponent(folderPath).replace(/%2F/g, "/");
  const encodedName = encodeURIComponent(fileName);

  if (blob.size > 4 * 1024 * 1024) {
    await uploadLargeFile(folderPath, fileName, blob, contentType);
    return;
  }

  await graphFetch(
    `/me/drive/root:${encodedFolder}/${encodedName}:/content`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    }
  );
}

/** Upload a large file (> 4MB) using an upload session. */
async function uploadLargeFile(
  folderPath: string,
  fileName: string,
  blob: Blob,
  _contentType: string
): Promise<void> {
  const encodedFolder = encodeURIComponent(folderPath).replace(/%2F/g, "/");
  const encodedName = encodeURIComponent(fileName);

  // Create upload session
  const sessionResponse = await graphFetch(
    `/me/drive/root:${encodedFolder}/${encodedName}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "rename" },
      }),
    }
  );

  const session = await sessionResponse.json();
  const uploadUrl: string = session.uploadUrl;

  // Upload in chunks of 3.2MB (must be multiple of 320KB)
  const chunkSize = 3276800;
  const arrayBuffer = await blob.arrayBuffer();
  let offset = 0;

  while (offset < blob.size) {
    const end = Math.min(offset + chunkSize, blob.size);
    const chunk = arrayBuffer.slice(offset, end);

    const token = await getAccessToken();
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}`,
        "Content-Length": String(chunk.byteLength),
      },
      body: chunk,
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(`Upload chunk failed: ${response.status}`);
    }

    offset = end;
  }
}

/** Get the current user's display name. */
export async function getUserDisplayName(): Promise<string> {
  const response = await graphFetch("/me");
  const user = await response.json();
  return user.displayName || user.userPrincipalName || "User";
}
