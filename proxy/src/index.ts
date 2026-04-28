import "dotenv/config";
import express from "express";
import cors from "cors";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import poRoutes from "./routes/purchase-orders.js";
import grpoRoutes from "./routes/grpo.js";
import extractRoutes from "./routes/extract.js";

function requireConfig() {
  const errors: string[] = [];
  const secret = process.env.JWT_SECRET ?? "";
  if (secret.length < 32) {
    errors.push("JWT_SECRET missing or shorter than 32 chars");
  }
  if (/change[_-]?this|placeholder|your[_-]/i.test(secret)) {
    errors.push("JWT_SECRET appears to be a placeholder; set a real random value");
  }
  if (!process.env.AZURE_TENANT_ID) errors.push("AZURE_TENANT_ID missing");
  if (!process.env.AZURE_CLIENT_ID) errors.push("AZURE_CLIENT_ID missing");
  const dom = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim();
  const users = (process.env.ALLOWED_USERS ?? "").trim();
  if (!dom && !users) {
    errors.push("Neither ALLOWED_EMAIL_DOMAIN nor ALLOWED_USERS set; refusing to authenticate everyone");
  }
  if (errors.length > 0) {
    console.error("[Proxy] Refusing to start due to config errors:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
requireConfig();

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// CORS
const origins = (process.env.CORS_ORIGIN ?? "").split(",").map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));

// Body parsing
app.use(express.json({ limit: "50mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Auth routes (no auth required)
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/po", requireAuth, poRoutes);
app.use("/api/grpo", requireAuth, grpoRoutes);
app.use("/api/extract", requireAuth, extractRoutes);

// JSON error handler — keeps body-parser failures from leaking stack traces as HTML.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "INVALID_JSON", message: "Request body is not valid JSON" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "PAYLOAD_TOO_LARGE", message: "Request body exceeds limit" });
    return;
  }
  console.error("[Proxy] Unhandled error:", err);
  res.status(500).json({ error: "INTERNAL", message: "Internal server error" });
});

// Start with HTTPS (self-signed cert) or HTTP
const certDir = path.resolve(process.cwd(), "certs");
const certFile = path.join(certDir, "cert.pem");
const keyFile = path.join(certDir, "key.pem");

if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  const sslOptions = {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile),
  };
  https.createServer(sslOptions, app).listen(PORT, "0.0.0.0", () => {
    console.log(`[Proxy] Receiving proxy running on HTTPS port ${PORT}`);
    console.log(`[Proxy] SAP SL: ${process.env.SAP_SL_URL}`);
    console.log(`[Proxy] Company DB: ${process.env.SAP_COMPANY_DB}`);
    console.log(`[Proxy] CORS origins: ${origins.join(", ")}`);
  });
} else {
  console.log("[Proxy] No certs found, starting HTTP (generate certs for HTTPS)");
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Proxy] Receiving proxy running on HTTP port ${PORT}`);
    console.log(`[Proxy] SAP SL: ${process.env.SAP_SL_URL}`);
    console.log(`[Proxy] Company DB: ${process.env.SAP_COMPANY_DB}`);
    console.log(`[Proxy] CORS origins: ${origins.join(", ")}`);
  });
}
