import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The receiving app as a native phone app (Dylan, 22 Oct 2026).
 *
 * Why: Gabriel reported that long receipts take forever because of the photo
 * upload. A web app is paused by the phone the moment the screen locks or the
 * receiver switches away, so the upload has to happen with the receiver
 * holding the screen open. A native app can hand photos to the phone's own
 * uploader, which keeps going on its own. The shell comes first; the
 * background upload builds on it.
 *
 * The web build is NOT abandoned. `dist` still deploys to GitHub Pages as it
 * does today, and every native-only path checks `Capacitor.isNativePlatform()`
 * first. Two shells, one codebase — the same arrangement as the Outside Sales
 * App (C:\Apps\merged-sales-app).
 */
const config: CapacitorConfig = {
  appId: "com.torksystems.receiving",
  appName: "Receiving",

  // Vite builds here; GitHub Pages serves the same folder.
  webDir: "dist",

  ios: {
    contentInset: "always",
  },

  android: {
    allowMixedContent: false,
  },

  // CapacitorHttp is deliberately left OFF. It sends request bodies across the
  // bridge as text, which is slow for photos of several megabytes — the exact
  // problem this app exists to fix. The webview's own fetch is used instead,
  // which means the proxy's CORS_ORIGIN and the Azure Blob CORS rule must
  // allow the app's addresses: capacitor://localhost (iPhone) and
  // https://localhost (Android).
};

export default config;
