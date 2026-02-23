import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

let activeScanner: Html5Qrcode | null = null;

/** Start the live barcode scanner using the back camera. */
export async function startScanner(
  elementId: string,
  onScan: (partNumber: string) => void
): Promise<void> {
  await stopScanner();

  activeScanner = new Html5Qrcode(elementId, {
    formatsToSupport: SUPPORTED_FORMATS,
    verbose: false,
  });

  // Try to get the back camera
  let cameraId: string | { facingMode: string } = {
    facingMode: "environment",
  };

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (cameras.length > 0) {
      const backCamera = cameras.find((c) =>
        c.label.toLowerCase().includes("back")
      );
      if (backCamera) {
        cameraId = backCamera.id;
      }
    }
  } catch {
    // Camera enumeration failed; use facingMode fallback
  }

  await activeScanner.start(
    cameraId,
    {
      fps: 10,
      qrbox: { width: 300, height: 100 },
      aspectRatio: 1.777,
    },
    (decodedText) => {
      onScan(decodedText.trim());
    },
    undefined
  );
}

/** Stop the active scanner and release the camera. */
export async function stopScanner(): Promise<void> {
  if (activeScanner) {
    try {
      const state = activeScanner.getState();
      if (state === 2) {
        // Html5QrcodeScannerState.SCANNING
        await activeScanner.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
    try {
      activeScanner.clear();
    } catch {
      // Ignore
    }
    activeScanner = null;
  }
}

/** Scan a barcode from a static image file. */
export async function scanFromFile(
  file: File
): Promise<string | null> {
  const tempScanner = new Html5Qrcode("temp-file-scanner", {
    formatsToSupport: SUPPORTED_FORMATS,
    verbose: false,
  });

  try {
    const result = await tempScanner.scanFile(file, false);
    return result.trim();
  } catch {
    return null;
  } finally {
    tempScanner.clear();
  }
}
