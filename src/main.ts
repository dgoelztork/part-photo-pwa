import { initAuth, getAccount, getAccessToken } from "./lib/auth";
import { renderLoginScreen } from "./screens/login-screen";
import { renderHomeScreen } from "./screens/home-screen";
import { renderScanScreen } from "./screens/scan-screen";
import { renderCaptureScreen } from "./screens/capture-screen";
import { renderExportScreen } from "./screens/export-screen";
import { DEFAULT_CSV_PATH, DEFAULT_PHOTO_FOLDER } from "./config";
import type { AppSettings, CapturedPhoto, Screen } from "./types";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;

// Persist settings in localStorage
function getSettings(): AppSettings {
  try {
    const stored = localStorage.getItem("app-settings");
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return {
    csvFilePath: DEFAULT_CSV_PATH,
    photoFolderPath: DEFAULT_PHOTO_FOLDER,
  };
}

function saveSettings(settings: AppSettings): void {
  localStorage.setItem("app-settings", JSON.stringify(settings));
}

// Simple hash-based router
function navigate(screen: Screen): void {
  window.location.hash = screen;
}

function getCurrentHash(): Screen {
  const hash = window.location.hash.replace("#", "") as Screen;
  const valid: Screen[] = ["login", "home", "scan", "capture", "export"];
  return valid.includes(hash) ? hash : "login";
}

// State that passes between screens
let currentPart: { partNumber: string; description: string } | null = null;
let currentPhotos: CapturedPhoto[] = [];

function renderScreen(screen: Screen): void {
  switch (screen) {
    case "login":
      renderLoginScreen(app, () => navigate("home"));
      break;

    case "home":
      renderHomeScreen(app, () => navigate("scan"), getSettings, saveSettings);
      break;

    case "scan":
      renderScanScreen(
        app,
        (partNumber, description) => {
          currentPart = { partNumber, description };
          navigate("capture");
        },
        () => navigate("home")
      );
      break;

    case "capture":
      if (!currentPart) {
        navigate("scan");
        return;
      }
      renderCaptureScreen(
        app,
        currentPart.partNumber,
        currentPart.description,
        (photos) => {
          currentPhotos = photos;
          navigate("export");
        },
        () => navigate("scan")
      );
      break;

    case "export":
      if (currentPhotos.length === 0) {
        navigate("capture");
        return;
      }
      renderExportScreen(
        app,
        currentPhotos,
        getSettings,
        () => {
          currentPart = null;
          currentPhotos = [];
          navigate("scan");
        },
        () => {
          currentPart = null;
          currentPhotos = [];
          navigate("home");
        }
      );
      break;
  }
}

// Router
window.addEventListener("hashchange", () => {
  renderScreen(getCurrentHash());
});

// Initialize
async function init(): Promise<void> {
  try {
    await initAuth();
    const account = getAccount();

    if (account) {
      // Silently refresh the token to validate the session is still good
      try {
        await getAccessToken();
      } catch {
        // Token expired and can't be silently renewed — need re-login
        navigate("login");
        return;
      }

      const target = getCurrentHash();
      if (target === "login") {
        navigate("home");
      } else {
        renderScreen(target);
      }
    } else {
      navigate("login");
    }
  } catch (err) {
    console.error("Auth init failed:", err);
    navigate("login");
  }
}

init();
