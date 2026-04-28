/**
 * Azure AD token validation + JWT issuance for proxy auth.
 *
 * Flow:
 * 1. PWA sends Azure AD access token to POST /api/auth/login
 * 2. Proxy validates the token by calling Microsoft Graph /me (if Graph can use it, it's valid)
 * 3. Proxy issues its own short-lived JWT for subsequent requests
 * 4. All other routes require the proxy JWT in Authorization header
 */

import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET!;
const EXPECTED_TID = process.env.AZURE_TENANT_ID!;
const EXPECTED_APP_ID = process.env.AZURE_CLIENT_ID!;
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();
const ALLOWED_USERS = (process.env.ALLOWED_USERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isEmailAllowed(email: string): boolean {
  const lower = email.toLowerCase();
  if (ALLOWED_USERS.includes(lower)) return true;
  if (ALLOWED_DOMAIN && lower.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  return false;
}

/** Validate an Azure AD access token: tenant/app match, then Graph for signature, then email allowlist. */
export async function validateAzureToken(
  token: string
): Promise<{ email: string; name: string }> {
  const claims = jwt.decode(token) as Record<string, string> | null;
  if (!claims || typeof claims !== "object") {
    throw new Error("Token is not a valid JWT");
  }
  if (claims.tid !== EXPECTED_TID) {
    throw new Error(`Token tenant mismatch: ${claims.tid}`);
  }
  const tokenAppId = claims.appid ?? claims.azp;
  if (tokenAppId !== EXPECTED_APP_ID) {
    throw new Error(`Token app mismatch: ${tokenAppId}`);
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Token validation failed: Graph returned ${res.status}`);
  }

  const profile = await res.json() as Record<string, string>;
  const email = profile.userPrincipalName ?? profile.mail ?? "unknown";
  const name = profile.displayName ?? "User";

  if (!isEmailAllowed(email)) {
    throw new Error(`Email not authorized: ${email}`);
  }

  return { email, name };
}

/** Issue a proxy JWT from validated Azure AD identity. */
export function issueProxyToken(email: string, name: string): string {
  return jwt.sign({ email, name }, JWT_SECRET, { expiresIn: "8h" });
}

/** Express middleware: require a valid proxy JWT on the request. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Missing token" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      email: string;
      name: string;
    };
    (req as any).user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid token" });
  }
}
