import {
  startScanner,
  stopScanner,
  scanFromFile,
} from "../lib/barcode-scanner";
import { lookupPart } from "../lib/csv-store";

interface ScanResult {
  partNumber: string;
  description: string;
}

export function renderScanScreen(
  container: HTMLElement,
  onPartScanned: (partNumber: string, description: string) => void,
  onBack: () => void
): void {
  container.innerHTML = `
    <div class="screen scan-screen">
      <div class="screen-header">
        <button id="back-btn" class="btn btn-text">&larr; Back</button>
        <h2>Scan Barcode</h2>
      </div>

      <div id="scanner-container" class="scanner-container">
        <div id="scanner-reader"></div>
        <p class="scanner-hint">Point camera at a barcode (Code 128 / Code 39)</p>
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
            Scan Again
          </button>
        </div>
      </div>

      <div class="scan-fallbacks">
        <button id="file-scan-btn" class="btn btn-secondary">
          Scan from Photo
        </button>
        <button id="manual-btn" class="btn btn-secondary">
          Enter Manually
        </button>
      </div>

      <div id="manual-entry" class="manual-entry" style="display: none;">
        <div class="card">
          <label class="field">
            <span>Part Number</span>
            <input id="manual-part" type="text" placeholder="Enter part number"
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

      <!-- Hidden elements for file scanning -->
      <div id="temp-file-scanner" style="display:none;"></div>
    </div>
  `;

  const backBtn = container.querySelector("#back-btn") as HTMLButtonElement;
  const fileScanBtn = container.querySelector(
    "#file-scan-btn"
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

  backBtn.addEventListener("click", async () => {
    await stopScanner();
    onBack();
  });

  // Start live scanner
  initScanner(container, onPartScanned);

  // File scan fallback
  fileScanBtn.addEventListener("click", () => {
    handleFileScan(container, onPartScanned);
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

  // Enter key on manual part input
  const manualPartInput = container.querySelector(
    "#manual-part"
  ) as HTMLInputElement;
  manualPartInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleManualEntry(container, onPartScanned);
    }
  });
}

async function initScanner(
  container: HTMLElement,
  onPartScanned: (partNumber: string, description: string) => void
): Promise<void> {
  const scannerHint = container.querySelector(
    ".scanner-hint"
  ) as HTMLElement;

  try {
    await startScanner("scanner-reader", (partNumber) => {
      handleScanResult(container, partNumber, onPartScanned);
    });
  } catch (err) {
    if (scannerHint) {
      scannerHint.textContent =
        "Camera not available. Use 'Scan from Photo' or 'Enter Manually' below.";
      scannerHint.classList.add("error-text");
    }
    console.warn("Scanner init failed:", err);
  }
}

function handleScanResult(
  container: HTMLElement,
  partNumber: string,
  onPartScanned: (partNumber: string, description: string) => void
): void {
  stopScanner();

  const result = resolvePart(partNumber);
  showResult(container, result, onPartScanned);
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

  continueBtn.onclick = async () => {
    await stopScanner();
    onPartScanned(result.partNumber, result.description);
  };

  rescanBtn.onclick = () => {
    scanResult.style.display = "none";
    initScanner(container, (pn, desc) => onPartScanned(pn, desc));
  };
}

function handleFileScan(
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

    const hint = container.querySelector(".scanner-hint") as HTMLElement;
    if (hint) hint.textContent = "Scanning image...";

    const partNumber = await scanFromFile(file);
    if (partNumber) {
      const result = resolvePart(partNumber);
      showResult(container, result, onPartScanned);
    } else {
      if (hint) {
        hint.textContent =
          "Could not read barcode from image. Try again or enter manually.";
        hint.classList.add("error-text");
      }
    }
    input.remove();
  };

  input.style.display = "none";
  document.body.appendChild(input);
  input.click();
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

  stopScanner();
  onPartScanned(partNumber, description);
}

function resolvePart(partNumber: string): ScanResult {
  const description = lookupPart(partNumber) ?? "Unknown-Part";
  return { partNumber: partNumber.toUpperCase(), description };
}
