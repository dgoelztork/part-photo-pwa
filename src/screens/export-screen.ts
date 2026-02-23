import {
  uploadPhotosToOneDrive,
  downloadAsZip,
} from "../lib/file-exporter";
import { revokePhotos } from "../lib/photo-manager";
import type { CapturedPhoto, AppSettings } from "../types";

export function renderExportScreen(
  container: HTMLElement,
  photos: CapturedPhoto[],
  getSettings: () => AppSettings,
  onNewScan: () => void,
  onHome: () => void
): void {
  container.innerHTML = `
    <div class="screen export-screen">
      <div class="screen-header">
        <h2>Upload Photos</h2>
      </div>

      <div class="export-list">
        ${photos
          .map(
            (p) => `
          <div class="export-item">
            <img src="${p.thumbnailUrl}" alt="${escapeHtml(p.finalName)}" />
            <span class="export-filename">${escapeHtml(p.finalName)}</span>
          </div>
        `
          )
          .join("")}
      </div>

      <div id="upload-progress" class="upload-progress" style="display: none;">
        <div class="progress-bar">
          <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
        </div>
        <span id="progress-text" class="progress-text">Uploading...</span>
      </div>

      <div id="upload-result" class="upload-result" style="display: none;"></div>

      <div id="action-buttons" class="export-actions">
        <button id="upload-btn" class="btn btn-primary btn-large">
          Upload to OneDrive
        </button>
        <button id="zip-btn" class="btn btn-secondary">
          Download as ZIP Instead
        </button>
      </div>

      <div id="done-buttons" class="export-actions" style="display: none;">
        <button id="new-scan-btn" class="btn btn-primary btn-large">
          Scan Another Part
        </button>
        <button id="home-btn" class="btn btn-secondary">
          Back to Home
        </button>
      </div>
    </div>
  `;

  const uploadBtn = container.querySelector(
    "#upload-btn"
  ) as HTMLButtonElement;
  const zipBtn = container.querySelector("#zip-btn") as HTMLButtonElement;
  const newScanBtn = container.querySelector(
    "#new-scan-btn"
  ) as HTMLButtonElement;
  const homeBtn = container.querySelector("#home-btn") as HTMLButtonElement;

  uploadBtn.addEventListener("click", () => {
    handleUpload(container, photos, getSettings);
  });

  zipBtn.addEventListener("click", async () => {
    zipBtn.disabled = true;
    zipBtn.textContent = "Creating ZIP...";
    try {
      await downloadAsZip(photos);
      zipBtn.textContent = "ZIP Downloaded!";
    } catch (err) {
      zipBtn.textContent = "Download Failed";
      console.error("ZIP download error:", err);
    }
  });

  newScanBtn.addEventListener("click", () => {
    revokePhotos(photos);
    onNewScan();
  });

  homeBtn.addEventListener("click", () => {
    revokePhotos(photos);
    onHome();
  });
}

async function handleUpload(
  container: HTMLElement,
  photos: CapturedPhoto[],
  getSettings: () => AppSettings
): Promise<void> {
  const actionButtons = container.querySelector(
    "#action-buttons"
  ) as HTMLElement;
  const doneButtons = container.querySelector(
    "#done-buttons"
  ) as HTMLElement;
  const progressEl = container.querySelector(
    "#upload-progress"
  ) as HTMLElement;
  const progressFill = container.querySelector(
    "#progress-fill"
  ) as HTMLElement;
  const progressText = container.querySelector(
    "#progress-text"
  ) as HTMLElement;
  const resultEl = container.querySelector(
    "#upload-result"
  ) as HTMLElement;

  actionButtons.style.display = "none";
  progressEl.style.display = "block";

  try {
    const settings = getSettings();
    await uploadPhotosToOneDrive(
      photos,
      settings.photoFolderPath,
      (progress) => {
        const pct = Math.round((progress.current / progress.total) * 100);
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `Uploading ${progress.current}/${progress.total}: ${progress.fileName}`;
      }
    );

    progressEl.style.display = "none";
    resultEl.style.display = "block";
    resultEl.innerHTML = `
      <div class="success-message">
        <span class="success-icon">&#10003;</span>
        <strong>${photos.length} photo${photos.length !== 1 ? "s" : ""} uploaded successfully!</strong>
        <p>Saved to: ${escapeHtml(getSettings().photoFolderPath)}</p>
      </div>
    `;
    doneButtons.style.display = "flex";
  } catch (err) {
    progressEl.style.display = "none";
    resultEl.style.display = "block";
    resultEl.innerHTML = `
      <div class="error-message">
        <strong>Upload failed</strong>
        <p>${escapeHtml((err as Error).message)}</p>
        <p>You can try again or download as ZIP instead.</p>
      </div>
    `;
    actionButtons.style.display = "flex";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
