import "dotenv/config";
import express from "express";
import cors from "cors";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import poRoutes from "./routes/purchase-orders.js";
import grpoRoutes from "./routes/grpo.js";

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

// Start
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Proxy] Receiving proxy running on port ${PORT}`);
  console.log(`[Proxy] SAP SL: ${process.env.SAP_SL_URL}`);
  console.log(`[Proxy] Company DB: ${process.env.SAP_COMPANY_DB}`);
  console.log(`[Proxy] CORS origins: ${origins.join(", ")}`);
});
