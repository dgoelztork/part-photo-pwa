/**
 * Azure AD token validation + JWT issuance for proxy auth.
 *
 * Flow:
 * 1. PWA sends Azure AD access token to POST /api/auth/login
 * 2. Proxy validates the token (signature, audience, tenant)
 * 3. Proxy issues its own short-lived JWT for subsequent requests
 * 4. All other routes require the proxy JWT in Authorization header
 */

import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import type { Request, Response, NextFunction } from "express";

const TENANT_ID = process.env.AZURE_TENANT_ID!;
const CLIENT_ID = process.env.AZURE_CLIENT_ID!;
const JWT_SECRET = process.env.JWT_SECRET!;

// JWKS client for verifying Azure AD tokens
const jwks = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
});

/** Validate an Azure AD access token. Returns the token payload. */
export async function validateAzureToken(
  token: string
): Promise<{ email: string; name: string }> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header, callback) => {
        jwks.getSigningKey(header.kid!, (err, key) => {
          if (err) return callback(err);
          callback(null, key!.getPublicKey());
        });
      },
      {
        audience: [CLIENT_ID, "https://graph.microsoft.com", `api://${CLIENT_ID}`],
        issuer: [
          `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
          `https://sts.windows.net/${TENANT_ID}/`,
        ],
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) return reject(err);
        const payload = decoded as Record<string, unknown>;
        resolve({
          email:
            (payload.preferred_username as string) ??
            (payload.upn as string) ??
            (payload.email as string) ??
            "unknown",
          name: (payload.name as string) ?? "User",
        });
      }
    );
  });
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
