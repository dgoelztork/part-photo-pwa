import Tesseract from "tesseract.js";

// Part number pattern: M followed by 7 digits
const PART_NUMBER_PATTERN = /M\d{7}/g;

let worker: Tesseract.Worker | null = null;

/** Initialize the Tesseract OCR worker (loads WASM + language data). */
async function getWorker(): Promise<Tesseract.Worker> {
  if (worker) return worker;
  worker = await Tesseract.createWorker("eng", 1, {
    logger: () => {}, // suppress progress logs
  });
  // Optimize for alphanumeric (part numbers only)
  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  });
  return worker;
}

/** Run OCR on an image blob/canvas and extract M-number part numbers. */
export async function recognizePartNumber(
  image: Blob | HTMLCanvasElement
): Promise<string | null> {
  const w = await getWorker();
  const result = await w.recognize(image);
  const text = result.data.text.replace(/\s+/g, "").toUpperCase();

  // Look for M + 7 digits pattern
  const matches = text.match(PART_NUMBER_PATTERN);
  return matches ? matches[0] : null;
}

/** Crop a video frame to a target rectangle and return as a canvas. */
export function cropVideoFrame(
  video: HTMLVideoElement,
  cropRect: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cropRect.width;
  canvas.height = cropRect.height;
  const ctx = canvas.getContext("2d")!;

  // Map crop rect from display coordinates to video coordinates
  const scaleX = video.videoWidth / video.clientWidth;
  const scaleY = video.videoHeight / video.clientHeight;

  ctx.drawImage(
    video,
    cropRect.x * scaleX,
    cropRect.y * scaleY,
    cropRect.width * scaleX,
    cropRect.height * scaleY,
    0,
    0,
    cropRect.width,
    cropRect.height
  );

  return canvas;
}

/** Crop a captured image file to a target rectangle. */
export async function cropImageFile(
  file: File,
  cropRect: { x: number; y: number; width: number; height: number },
  displayWidth: number,
  displayHeight: number
): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = cropRect.width;
  canvas.height = cropRect.height;
  const ctx = canvas.getContext("2d")!;

  const scaleX = img.width / displayWidth;
  const scaleY = img.height / displayHeight;

  ctx.drawImage(
    img,
    cropRect.x * scaleX,
    cropRect.y * scaleY,
    cropRect.width * scaleX,
    cropRect.height * scaleY,
    0,
    0,
    cropRect.width,
    cropRect.height
  );

  return canvas;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Start the camera stream for live preview. */
export async function startCamera(
  videoElement: HTMLVideoElement
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  videoElement.srcObject = stream;
  await videoElement.play();
  return stream;
}

/** Stop the camera stream. */
export function stopCamera(stream: MediaStream | null): void {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

/** Clean up the OCR worker. */
export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
