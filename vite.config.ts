import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import mkcert from "vite-plugin-mkcert";
import tailwindcss from "@tailwindcss/vite";

const base = process.env.GITHUB_PAGES ? "/part-photo-pwa/" : "/";
// Set VITE_NO_MKCERT=1 to skip the local CA (e.g. when fronting with Tailscale
// serve, which terminates TLS upstream with a real cert).
const useMkcert = !process.env.VITE_NO_MKCERT;

export default defineConfig({
  base,
  plugins: [
    ...(useMkcert ? [mkcert()] : []),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icons/*.png"],
      manifest: {
        // Stable id so iOS/Android treat re-installs as the same PWA
        // and don't accumulate ghost shortcuts after manifest changes.
        id: "tork-receiving",
        name: "Part Receiving",
        short_name: "Receiving",
        description: "Warehouse receiving workflow with photo documentation",
        theme_color: "#1a73e8",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: base,
        start_url: base,
        icons: [
          {
            src: "icons/apple-touch-icon-180x180.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
