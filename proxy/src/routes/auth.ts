import { Router } from "express";
import { validateAzureToken, issueProxyToken } from "../middleware/auth.js";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { azureToken: "eyJ..." }
 * Returns: { jwt: "proxy-token", user: { email, name } }
 */
router.post("/login", async (req, res) => {
  const { azureToken } = req.body ?? {};

  if (!azureToken) {
    res.status(400).json({ error: "MISSING_TOKEN", message: "azureToken required" });
    return;
  }

  try {
    const { email, name } = await validateAzureToken(azureToken);
    const token = issueProxyToken(email, name);
    console.log(`[Auth] Issued proxy token for ${email}`);
    res.json({ jwt: token, user: { email, name } });
  } catch (err) {
    console.error("[Auth] Azure token validation failed:", err);
    res.status(401).json({
      error: "INVALID_AZURE_TOKEN",
      message: "Azure AD token validation failed",
    });
  }
});

export default router;
