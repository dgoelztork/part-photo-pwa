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
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET!;
const EXPECTED_TID = process.env.AZURE_TENANT_ID!;
const EXPECTED_APP_ID = process.env.AZURE_CLIENT_ID!;
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();
const ALLOWED_USERS = (process.env.ALLOWED_USERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Microsoft's docs caution against validating access tokens for APIs you don't own
// (Graph). The architecturally correct fix is to register this proxy as its own API in
// Azure AD and have the PWA request tokens for that audience. Until that's done, we
// validate the v2.0 Graph-scoped access token locally; works for current MSAL flows.
const JWKS = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${EXPECTED_TID}/discovery/v2.0/keys`)
);
const ISSUERS = [
  `https://login.microsoftonline.com/${EXPECTED_TID}/v2.0`,
  `https://sts.windows.net/${EXPECTED_TID}/`,
];

function isEmailAllowed(email: string): boolean {
  const lower = email.toLowerCase();
  if (ALLOWED_USERS.includes(lower)) return true;
  if (ALLOWED_DOMAIN && lower.endsWith(`@${ALLOWED_DOMAIN}`)) return true;
  return false;
}

/** Validate an Azure AD access token: signature/issuer/expiry via JWKS, then tenant/app/email checks. */
export async function validateAzureToken(
  token: string
): Promise<{ email: string; name: string }> {
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUERS });

  if (payload.tid !== EXPECTED_TID) {
    throw new Error(`Token tenant mismatch: ${payload.tid}`);
  }
  const tokenAppId = (payload.appid ?? payload.azp) as string | undefined;
  if (tokenAppId !== EXPECTED_APP_ID) {
    throw new Error(`Token app mismatch: ${tokenAppId}`);
  }

  const email = (payload.preferred_username ?? payload.upn ?? payload.email ?? "unknown") as string;
  const name = (payload.name ?? "User") as string;

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
