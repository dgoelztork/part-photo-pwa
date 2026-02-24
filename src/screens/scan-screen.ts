import {
  startCamera,
  stopCamera,
  cropVideoFrame,
  recognizePartNumber,
} from "../lib/ocr-reader";
import { lookupPart } from "../lib/csv-store";

interface ScanResult {
  partNumber: string;
  description: string;
}

let activeStream: MediaStream | null = null;

export function renderScanScreen(
  container: HTMLElement,
  onPartScanned: (partNumber: string, description: string) => void,
  onBack: () => void
): void {
  container.innerHTML = `
    <div class="screen scan-screen">
      <div class="screen-header">
        <button id="back-btn" class="btn btn-text">&larr; Back</button>
        <h2>Read Part Number</h2>
      </div>

      <div class="camera-section">
        <div id="camera-container" class="camera-container">
          <video id="camera-preview" autoplay playsinline muted></video>
          <div class="camera-target"></div>
        </div>
        <p id="camera-hint" class="scanner-hint">
          Position part number (M#######) inside the box
        </p>
        <button id="capture-read-btn" class="btn btn-primary btn-large">
          Capture &amp; Read
        </button>
      </div>

      <div id="ocr-status" class="ocr-status" style="display: none;">
        <span class="status-loading">Reading text...</span>
      </div>

      <div id="scan-result" class="scan-result" style="display: none;">
        <div class="result-card card">
          <div class="result-field">
            <label>Part Number</label>
            <span id="result-part"></span>
          </div>
          <div class="result-field">
            <label>Description</label>
            <span id="result-desc"></span>
          </div>
          <button id="continue-btn" class="btn btn-primary">
            Continue to Photos
          </button>
          <button id="rescan-btn" class="btn btn-secondary">
            Try Again
          </button>
        </div>
      </div>

      <div class="scan-fallbacks">
        <button id="photo-scan-btn" class="btn btn-secondary">
          Take Photo Instead
        </button>
        <button id="manual-btn" class="btn btn-secondary">
          Enter Manually
        </button>
      </div>

      <div id="manual-entry" class="manual-entry" style="display: none;">
        <div class="card">
          <label class="field">
            <span>Part Number</span>
            <input id="manual-part" type="text" placeholder="e.g. M1024253"
                   autocapitalize="characters" />
          </label>
          <label class="field">
            <span>Description (optional override)</span>
            <input id="manual-desc" type="text" placeholder="Leave blank to use catalog" />
          </label>
          <button id="manual-lookup-btn" class="btn btn-primary">
            Look Up &amp; Continue
          </button>
        </div>
      </div>
    </div>
  `;

  const backBtn = container.querySelector("#back-btn") as HTMLButtonElement;
  const captureBtn = container.querySelector(
    "#capture-read-btn"
  ) as HTMLButtonElement;
  const photoScanBtn = container.querySelector(
    "#photo-scan-btn"
  ) as HTMLButtonElement;
  const manualBtn = container.querySelector(
    "#manual-btn"
  ) as HTMLButtonElement;
  const manualEntry = container.querySelector(
    "#manual-entry"
  ) as HTMLElement;
  const manualLookupBtn = container.querySelector(
    "#manual-lookup-btn"
  ) as HTMLButtonElement;

  // Back — stop camera and navigate
  backBtn.addEventListener("click", () => {
    cleanup();
    onBack();
  });

  // Start live camera preview
  initCamera(container);

  // Capture & Read — grab frame, OCR it
  captureBtn.addEventListener("click", () => {
    handleCaptureAndRead(container, onPartScanned);
  });

  // Take Photo fallback (uses native camera via <input capture>)
  photoScanBtn.addEventListener("click", () => {
    handlePhotoScan(container, onPartScanned);
  });

  // Manual entry toggle
  manualBtn.addEventListener("click", () => {
    manualEntry.style.display =
      manualEntry.style.display === "none" ? "block" : "none";
    if (manualEntry.style.display === "block") {
      (container.querySelector("#manual-part") as HTMLInputElement).focus();
    }
  });

  // Manual lookup
  manualLookupBtn.addEventListener("click", () => {
    handleManualEntry(container, onPartScanned);
  });

  const manualPartInput = container.querySelector(
    "#manual-part"
  ) as HTMLInputElement;
  manualPartInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleManualEntry(container, onPartScanned);
    }
  });
}

function cleanup(): void {
  stopCamera(activeStream);
  activeStream = null;
}

async function initCamera(container: HTMLElement): Promise<void> {
  const video = container.querySelector(
    "#camera-preview"
  ) as HTMLVideoElement;
  const hint = container.querySelector("#camera-hint") as HTMLElement;
  const captureBtn = container.querySelector(
    "#capture-read-btn"
  ) as HTMLButtonElement;

  try {
    activeStream = await startCamera(video);
  } catch (err) {
    console.warn("Camera init failed:", err);
    if (hint) {
      hint.textContent =
        "Camera not available. Use 'Take Photo Instead' or 'Enter Manually'.";
      hint.classList.add("error-text");
    }
    captureBtn.style.display = "none";
    // Hide the video container
    const camContainer = container.querySelector(
      "#camera-container"
    ) as HTMLElement;
    if (camContainer) camContainer.style.display = "none";
  }
}

async function handleCaptureAndRead(
  container: HTMLElement,
  onPartScanned: (partNumber: string, description: string) => void
): Promise<void> {
  const video = container.querySelector(
    "#camera-preview"
  ) as HTMLVideoElement;
  const captureBtn = container.querySelector(
    "#capture-read-btn"
  ) as HTMLButtonElement;
  const ocrStatus = container.querySelector("#ocr-status") as HTMLElement;
  const hint = container.querySelector("#camera-hint") as HTMLElement;

  if (!video.videoWidth) return;

  captureBtn.disabled = true;
  ocrStatus.style.display = "block";

  // Crop to the target box area (center strip)
  const targetRect = getTargetRect(video);
  const cropped = cropVideoFrame(video, targetRect);

  try {
    const partNumber = await recognizePartNumber(cropped);
    ocrStatus.style.display = "none";

    if (partNumber) {
      const result = resolvePart(partNumber);
      showResult(container, result, onPartScanned);
    } else {
      hint.textContent =
        "No part number found (M#######). Reposition and try again.";
      hint.classList.add("error-text");
      captureBtn.disabled = false;
    }
  } catch (err) {
    console.error("OCR error:", err);
    ocrStatus.style.display = "none";
    hint.textContent = "Reading failed. Try again or enter manually.";
    hint.classList.add("error-text");
    captureBtn.disabled = false;
  }
}

/** Calculate the crop rectangle matching the on-screen target box. */
function getTargetRect(video: HTMLVideoElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  // The CSS target box is 80% width, 60px tall, centered
  const containerWidth = video.clientWidth;
  const containerHeight = video.clientHeight;
  const boxWidth = containerWidth * 0.8;
  const boxHeight = 60;
  const x = (containerWidth - boxWidth) / 2;
  const y = (containerHeight - boxHeight) / 2;

  return { x, y, width: boxWidth, height: boxHeight };
}

function handlePhotoScan(
  container: HTMLElement,
  onPartScanned: (partNumber: string, description: string) => void
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    const ocrStatus = container.querySelector("#ocr-status") as HTMLElement;
    const hint = container.querySelector("#camera-hint") as HTMLElement;
    ocrStatus.style.display = "block";
    ocrStatus.innerHTML = '<span class="status-loading">Reading photo...</span>';

    try {
      // For photo fallback, show the image and let user see what was captured
      // OCR the full image since we can't crop interactively
      const partNumber = await recognizePartNumber(file);

      ocrStatus.style.display = "none";

      if (partNumber) {
        const result = resolvePart(partNumber);
        showResult(container, result, onPartScanned);
      } else {
        hint.textContent =
          "No part number found (M#######). Try getting closer or enter manually.";
        hint.classList.add("error-text");
      }
    } catch (err) {
      console.error("Photo OCR error:", err);
      ocrStatus.style.display = "none";
      hint.textContent = "Reading failed. Try again or enter manually.";
      hint.classList.add("error-text");
    }
    input.remove();
  };

  input.style.display = "none";
  document.body.appendChild(input);
  input.click();
}

function showResult(
  container: HTMLElement,
  result: ScanResult,
  onPartScanned: (partNumber: string, description: string) => void
): void {
  const scanResult = container.querySelector("#scan-result") as HTMLElement;
  const resultPart = container.querySelector("#result-part") as HTMLElement;
  const resultDesc = container.querySelector("#result-desc") as HTMLElement;
  const continueBtn = container.querySelector(
    "#continue-btn"
  ) as HTMLButtonElement;
  const rescanBtn = container.querySelector(
    "#rescan-btn"
  ) as HTMLButtonElement;

  resultPart.textContent = result.partNumber;
  resultDesc.textContent = result.description || "(no description found)";
  scanResult.style.display = "block";

  // Hide camera controls when showing result
  const cameraSection = container.querySelector(
    ".camera-section"
  ) as HTMLElement;
  if (cameraSection) cameraSection.style.display = "none";

  continueBtn.onclick = () => {
    cleanup();
    onPartScanned(result.partNumber, result.description);
  };

  rescanBtn.onclick = () => {
    scanResult.style.display = "none";
    if (cameraSection) cameraSection.style.display = "block";
    const hint = container.querySelector("#camera-hint") as HTMLElement;
    if (hint) {
      hint.textContent = "Position part number (M#######) inside the box";
      hint.classList.remove("error-text");
    }
    const captureBtn = container.querySelector(
      "#capture-read-btn"
    ) as HTMLButtonElement;
    if (captureBtn) captureBtn.disabled = false;
    initCamera(container);
  };
}

function handleManualEntry(
  container: HTMLElement,
  onPartScanned: (partNumber: string, description: string) => void
): void {
  const partInput = container.querySelector(
    "#manual-part"
  ) as HTMLInputElement;
  const descInput = container.querySelector(
    "#manual-desc"
  ) as HTMLInputElement;

  const partNumber = partInput.value.trim().toUpperCase();
  if (!partNumber) {
    partInput.classList.add("input-error");
    return;
  }
  partInput.classList.remove("input-error");

  const manualDesc = descInput.value.trim();
  const catalogDesc = lookupPart(partNumber);
  const description = manualDesc || catalogDesc || "Unknown-Part";

  cleanup();
  onPartScanned(partNumber, description);
}

function resolvePart(partNumber: string): ScanResult {
  const description = lookupPart(partNumber) ?? "Unknown-Part";
  return { partNumber: partNumber.toUpperCase(), description };
}
