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

/** Validate an Azure AD access token by calling Graph /me with it. */
export async function validateAzureToken(
  token: string
): Promise<{ email: string; name: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Token validation failed: Graph returned ${res.status}`);
  }

  const profile = await res.json() as Record<string, string>;
  return {
    email: profile.userPrincipalName ?? profile.mail ?? "unknown",
    name: profile.displayName ?? "User",
  };
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
