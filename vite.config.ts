import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import mkcert from "vite-plugin-mkcert";

const base = process.env.GITHUB_PAGES ? "/part-photo-pwa/" : "/";

export default defineConfig({
  base,
  plugins: [
    mkcert(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icons/*.png"],
      manifest: {
        name: "Part Photo Scanner",
        short_name: "PartPhoto",
        description: "Scan barcodes, capture and rename part photos",
        theme_color: "#1a73e8",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: base,
        start_url: base,
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
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
