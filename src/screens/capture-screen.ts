import {
  capturePhoto,
  processCapture,
  buildFileName,
  revokePhotos,
} from "../lib/photo-manager";
import type { CapturedPhoto } from "../types";

export function renderCaptureScreen(
  container: HTMLElement,
  partNumber: string,
  description: string,
  onExport: (photos: CapturedPhoto[]) => void,
  onBack: () => void
): void {
  const photos: CapturedPhoto[] = [];

  container.innerHTML = `
    <div class="screen capture-screen">
      <div class="screen-header">
        <button id="back-btn" class="btn btn-text">&larr; Back</button>
        <h2>Capture Photos</h2>
      </div>

      <div class="part-info card">
        <div class="part-info-row">
          <label>Part</label>
          <span>${escapeHtml(partNumber)}</span>
        </div>
        <div class="part-info-row">
          <label>Description</label>
          <span>${escapeHtml(description)}</span>
        </div>
        <div class="part-info-row filename-preview">
          <label>File name</label>
          <span id="filename-preview">${escapeHtml(buildFileName(partNumber, description, 0))}</span>
        </div>
      </div>

      <button id="capture-btn" class="btn btn-primary btn-large">
        Take Photo
      </button>

      <div id="photo-grid" class="photo-grid"></div>

      <div class="capture-footer">
        <span id="photo-count" class="photo-count">0 photos</span>
        <button id="export-btn" class="btn btn-primary" disabled>
          Upload to OneDrive
        </button>
      </div>
    </div>
  `;

  const backBtn = container.querySelector("#back-btn") as HTMLButtonElement;
  const captureBtn = container.querySelector(
    "#capture-btn"
  ) as HTMLButtonElement;
  const exportBtn = container.querySelector(
    "#export-btn"
  ) as HTMLButtonElement;
  const photoGrid = container.querySelector("#photo-grid") as HTMLElement;
  const photoCount = container.querySelector("#photo-count") as HTMLElement;
  const filenamePreview = container.querySelector(
    "#filename-preview"
  ) as HTMLElement;

  backBtn.addEventListener("click", () => {
    revokePhotos(photos);
    onBack();
  });

  captureBtn.addEventListener("click", async () => {
    captureBtn.disabled = true;
    captureBtn.textContent = "Opening camera...";

    try {
      const file = await capturePhoto();
      if (file) {
        const photo = processCapture(
          file,
          partNumber,
          description,
          photos.length
        );
        photos.push(photo);
        addPhotoToGrid(photoGrid, photo, photos, () => {
          updateUI();
        });
        updateUI();
      }
    } catch (err) {
      console.error("Capture error:", err);
    } finally {
      captureBtn.disabled = false;
      captureBtn.textContent = "Take Photo";
    }
  });

  exportBtn.addEventListener("click", () => {
    if (photos.length > 0) {
      onExport([...photos]);
    }
  });

  function updateUI(): void {
    const count = photos.length;
    photoCount.textContent = `${count} photo${count !== 1 ? "s" : ""}`;
    exportBtn.disabled = count === 0;
    filenamePreview.textContent = buildFileName(
      partNumber,
      description,
      Math.max(0, count - 1)
    );

    // Re-number existing photos after deletions
    photos.forEach((p, i) => {
      p.finalName = buildFileName(partNumber, description, i);
    });
    updateGridLabels(photoGrid, photos);
  }
}

function addPhotoToGrid(
  grid: HTMLElement,
  photo: CapturedPhoto,
  photos: CapturedPhoto[],
  onUpdate: () => void
): void {
  const item = document.createElement("div");
  item.className = "photo-item";
  item.dataset.index = String(photos.length - 1);

  item.innerHTML = `
    <img src="${photo.thumbnailUrl}" alt="${escapeHtml(photo.finalName)}" />
    <span class="photo-label">${escapeHtml(photo.finalName)}</span>
    <button class="photo-delete" title="Remove">&times;</button>
  `;

  item.querySelector(".photo-delete")!.addEventListener("click", () => {
    const idx = photos.indexOf(photo);
    if (idx > -1) {
      URL.revokeObjectURL(photo.thumbnailUrl);
      photos.splice(idx, 1);
      item.remove();
      onUpdate();
    }
  });

  grid.appendChild(item);
}

function updateGridLabels(
  grid: HTMLElement,
  photos: CapturedPhoto[]
): void {
  const items = grid.querySelectorAll(".photo-item");
  items.forEach((item, i) => {
    if (photos[i]) {
      const label = item.querySelector(".photo-label");
      if (label) label.textContent = photos[i].finalName;
    }
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
