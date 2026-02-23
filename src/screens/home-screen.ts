import { downloadFile, getUserDisplayName } from "../lib/graph-client";
import {
  importCSVText,
  loadCatalog,
  getPartsCount,
  getCatalogMeta,
} from "../lib/csv-store";
import { signOut } from "../lib/auth";
import { DEFAULT_CSV_PATH, DEFAULT_PHOTO_FOLDER } from "../config";
import type { AppSettings } from "../types";

export function renderHomeScreen(
  container: HTMLElement,
  onStartScan: () => void,
  getSettings: () => AppSettings,
  saveSettings: (settings: AppSettings) => void
): void {
  const settings = getSettings();

  container.innerHTML = `
    <div class="screen home-screen">
      <div class="home-header">
        <h1>Part Photo Scanner</h1>
        <div class="user-info">
          <span id="user-name">Loading...</span>
          <button id="sign-out-btn" class="btn btn-text btn-small">Sign out</button>
        </div>
      </div>

      <div class="card status-card">
        <h2>Parts Catalog</h2>
        <div id="parts-status" class="status-info">
          <span class="status-loading">Checking...</span>
        </div>
        <button id="refresh-btn" class="btn btn-secondary">
          Refresh Parts List
        </button>
      </div>

      <div class="card settings-card">
        <h2>OneDrive Settings</h2>
        <label class="field">
          <span>CSV File Path</span>
          <input id="csv-path" type="text" value="${escapeAttr(settings.csvFilePath)}"
                 placeholder="${DEFAULT_CSV_PATH}" />
        </label>
        <label class="field">
          <span>Photo Upload Folder</span>
          <input id="photo-folder" type="text" value="${escapeAttr(settings.photoFolderPath)}"
                 placeholder="${DEFAULT_PHOTO_FOLDER}" />
        </label>
        <button id="save-settings-btn" class="btn btn-secondary btn-small">
          Save Settings
        </button>
      </div>

      <button id="start-scan-btn" class="btn btn-primary btn-large" disabled>
        Start Scanning
      </button>
    </div>
  `;

  // Wire up events
  const refreshBtn = container.querySelector(
    "#refresh-btn"
  ) as HTMLButtonElement;
  const startBtn = container.querySelector(
    "#start-scan-btn"
  ) as HTMLButtonElement;
  const signOutBtn = container.querySelector(
    "#sign-out-btn"
  ) as HTMLButtonElement;
  const saveSettingsBtn = container.querySelector(
    "#save-settings-btn"
  ) as HTMLButtonElement;

  startBtn.addEventListener("click", onStartScan);
  signOutBtn.addEventListener("click", () => signOut());

  saveSettingsBtn.addEventListener("click", () => {
    const csvPath = (
      container.querySelector("#csv-path") as HTMLInputElement
    ).value.trim();
    const photoFolder = (
      container.querySelector("#photo-folder") as HTMLInputElement
    ).value.trim();
    saveSettings({
      csvFilePath: csvPath || DEFAULT_CSV_PATH,
      photoFolderPath: photoFolder || DEFAULT_PHOTO_FOLDER,
    });
    saveSettingsBtn.textContent = "Saved!";
    setTimeout(() => (saveSettingsBtn.textContent = "Save Settings"), 1500);
  });

  refreshBtn.addEventListener("click", () => {
    fetchPartsFromOneDrive(container, getSettings, startBtn, refreshBtn);
  });

  // Load user info and existing catalog
  initHomeScreen(container, getSettings, startBtn, refreshBtn);
}

async function initHomeScreen(
  container: HTMLElement,
  getSettings: () => AppSettings,
  startBtn: HTMLButtonElement,
  refreshBtn: HTMLButtonElement
): Promise<void> {
  // Load user name
  try {
    const name = await getUserDisplayName();
    const nameEl = container.querySelector("#user-name");
    if (nameEl) nameEl.textContent = name;
  } catch {
    const nameEl = container.querySelector("#user-name");
    if (nameEl) nameEl.textContent = "Signed in";
  }

  // Try loading cached catalog
  const hasCached = await loadCatalog();
  if (hasCached) {
    const meta = await getCatalogMeta();
    updateStatus(container, getPartsCount(), meta?.importedAt ?? null);
    startBtn.disabled = false;
  } else {
    // No cache — auto-fetch from OneDrive
    fetchPartsFromOneDrive(container, getSettings, startBtn, refreshBtn);
  }
}

async function fetchPartsFromOneDrive(
  container: HTMLElement,
  getSettings: () => AppSettings,
  startBtn: HTMLButtonElement,
  refreshBtn: HTMLButtonElement
): Promise<void> {
  const statusEl = container.querySelector("#parts-status");
  if (statusEl)
    statusEl.innerHTML = '<span class="status-loading">Fetching from OneDrive...</span>';
  refreshBtn.disabled = true;

  try {
    const settings = getSettings();
    const csvText = await downloadFile(settings.csvFilePath);
    const count = await importCSVText(csvText);
    updateStatus(container, count, new Date().toISOString());
    startBtn.disabled = false;
  } catch (err) {
    if (statusEl)
      statusEl.innerHTML = `<span class="error-text">Error: ${(err as Error).message}</span>`;
    // If we have a cached version, still allow scanning
    if (getPartsCount() > 0) {
      startBtn.disabled = false;
    }
  } finally {
    refreshBtn.disabled = false;
  }
}

function updateStatus(
  container: HTMLElement,
  count: number,
  lastSync: string | null
): void {
  const statusEl = container.querySelector("#parts-status");
  if (!statusEl) return;

  const syncText = lastSync
    ? `Last synced: ${new Date(lastSync).toLocaleString()}`
    : "";

  statusEl.innerHTML = `
    <span class="status-count">${count.toLocaleString()} parts loaded</span>
    ${syncText ? `<span class="status-sync">${syncText}</span>` : ""}
  `;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
