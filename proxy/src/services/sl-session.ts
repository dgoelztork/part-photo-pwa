/**
 * SAP B1 Service Layer session manager.
 * Handles login, session cookies, and transparent re-authentication.
 */

interface SLSession {
  sessionId: string;
  routeId: string;
  createdAt: number;
  lastUsedAt: number;
}

const SL_URL = process.env.SAP_SL_URL!;
const COMPANY_DB = process.env.SAP_COMPANY_DB!;
const USERNAME = process.env.SAP_USERNAME!;
const PASSWORD = process.env.SAP_PASSWORD!;
const TIMEOUT_MS = 25 * 60 * 1000; // 25 min (SL default timeout is 30)

let currentSession: SLSession | null = null;

/** Login to Service Layer and get session cookies. */
async function login(): Promise<SLSession> {
  console.log(`[SL] Logging in to ${SL_URL} as ${USERNAME}...`);

  const res = await fetch(`${SL_URL}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: COMPANY_DB,
      UserName: USERNAME,
      Password: PASSWORD,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SL Login failed (${res.status}): ${text}`);
  }

  // Extract session cookies
  const cookies = res.headers.getSetCookie?.() ?? [];
  let sessionId = "";
  let routeId = "";

  for (const cookie of cookies) {
    if (cookie.startsWith("B1SESSION=")) {
      sessionId = cookie.split("=")[1].split(";")[0];
    }
    if (cookie.startsWith("ROUTEID=")) {
      routeId = cookie.split("=")[1].split(";")[0];
    }
  }

  // Fallback: parse from response body
  if (!sessionId) {
    const body = await res.json().catch(() => ({})) as Record<string, string>;
    sessionId = body.SessionId ?? "";
  }

  if (!sessionId) {
    throw new Error("SL Login succeeded but no session ID received");
  }

  console.log(`[SL] Login successful, session: ${sessionId.slice(0, 8)}...`);

  const session: SLSession = {
    sessionId,
    routeId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  currentSession = session;
  return session;
}

/** Get a valid SL session, re-authenticating if needed. */
async function getSession(): Promise<SLSession> {
  if (currentSession) {
    const age = Date.now() - currentSession.lastUsedAt;
    if (age < TIMEOUT_MS) {
      currentSession.lastUsedAt = Date.now();
      return currentSession;
    }
    console.log("[SL] Session expired, re-authenticating...");
  }
  return login();
}

/** Build the Cookie header for SL requests. */
function buildCookieHeader(session: SLSession): string {
  let cookie = `B1SESSION=${session.sessionId}`;
  if (session.routeId) cookie += `; ROUTEID=${session.routeId}`;
  return cookie;
}

/**
 * Make an authenticated request to Service Layer.
 * Handles 401 by re-authenticating once and retrying.
 */
export async function slFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  let session = await getSession();

  const doRequest = async (s: SLSession) => {
    return fetch(`${SL_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Cookie: buildCookieHeader(s),
        ...options.headers,
      },
    });
  };

  let res = await doRequest(session);

  // Re-auth on 401
  if (res.status === 401) {
    console.log("[SL] Got 401, re-authenticating...");
    session = await login();
    res = await doRequest(session);
  }

  return res;
}

/**
 * Parse SL error response into a structured error.
 */
export async function parseSLError(
  res: Response
): Promise<{ code: number; message: string }> {
  try {
    const body = await res.json() as Record<string, any>;
    const err = body?.error ?? body;
    return {
      code: err?.code ?? res.status,
      message: err?.message?.value ?? err?.message ?? `SL error ${res.status}`,
    };
  } catch {
    return { code: res.status, message: `SL error ${res.status}` };
  }
}
