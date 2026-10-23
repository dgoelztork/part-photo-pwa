/**
 * Signing in when the app runs as a native phone app.
 *
 * The browser build uses MSAL, which assumes the app is served from a web
 * address Azure has been told about. A packaged app is not: it runs from
 * inside the app bundle, at `capacitor://localhost` (iPhone) or
 * `https://localhost` (Android). Azure will not accept those as sign-in
 * addresses, so MSAL cannot be used as it stands.
 *
 * This does the standard authorization-code-with-PKCE exchange directly with
 * Capacitor's browser and app plugins — the same approach as the Outside Sales
 * App (C:\Apps\merged-sales-app, web/src/lib/auth-native.ts). One difference:
 * that app needs a Microsoft token ONCE, to swap for its own server token. This
 * one uploads straight to SharePoint through Microsoft Graph all day, so it
 * also keeps the refresh token and renews the access token itself, or the
 * receiver would be sent back to sign in every hour.
 *
 * Token calls go through CapacitorHttp, not fetch. Azure refuses to redeem a
 * code or refresh token from a cross-origin browser request unless the
 * redirect address is registered as a single-page app — which a mobile
 * redirect is not. The native HTTP layer sends no Origin, so Azure treats it
 * as the mobile app it is.
 *
 * Sign-in opens the SYSTEM browser, not a view inside the app. Apple and Google
 * both require it, and it lets a receiver already signed in to Microsoft on
 * the phone pass straight through.
 */
import { CapacitorHttp } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import { MSAL_CONFIG, GRAPH_SCOPES, TENANT_DOMAIN_HINT } from "../config";

/**
 * Where Azure sends the receiver back to. Microsoft's own convention for
 * mobile. Must match Info.plist, AndroidManifest.xml, and the iOS and Android
 * platforms on the app registration.
 */
export const NATIVE_REDIRECT = "msauth.com.torksystems.receiving://auth";

const AUTHORITY = MSAL_CONFIG.auth.authority;
const CLIENT_ID = MSAL_CONFIG.auth.clientId;
const SCOPE = [...GRAPH_SCOPES, "offline_access", "openid", "profile"].join(" ");
const STORE_KEY = "native-auth";
/** Renew this long before the access token actually expires. */
const RENEW_EARLY_MS = 5 * 60 * 1000;

export interface NativeAccount {
  name?: string;
  username: string;
}

interface Stored {
  account: NativeAccount;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

let state: Stored | null = null;
let renewing: Promise<string> | null = null;

/** Load a saved sign-in, if there is one. Safe to call more than once. */
export async function initNativeAuth(): Promise<void> {
  if (state) return;
  const { value } = await Preferences.get({ key: STORE_KEY });
  if (!value) return;
  try {
    state = JSON.parse(value) as Stored;
  } catch {
    await Preferences.remove({ key: STORE_KEY });
  }
}

export function getNativeAccount(): NativeAccount | null {
  return state?.account ?? null;
}

/** Signs in and returns the account, or null if the receiver backed out. */
export async function signInNative(): Promise<NativeAccount | null> {
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const expectedState = randomString(24);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: NATIVE_REDIRECT,
    response_mode: "query",
    scope: SCOPE,
    state: expectedState,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Straight to the Tork sign-in rather than asking which organisation
    // first — the same hint the browser build passes.
    domain_hint: TENANT_DOMAIN_HINT,
  });

  // The listener goes on BEFORE the browser opens: on a phone already signed
  // in to Microsoft the redirect can arrive before a later listener existed.
  const redirected = waitForRedirect(expectedState);
  await Browser.open({ url: `${AUTHORITY}/oauth2/v2.0/authorize?${params}` });

  const code = await redirected;
  // Best-effort: on Android the system browser has usually gone already.
  await Browser.close().catch(() => {});
  if (!code) return null;

  await saveTokens(
    await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: NATIVE_REDIRECT,
      code_verifier: verifier,
    }),
  );
  return state!.account;
}

export async function signOutNative(): Promise<void> {
  state = null;
  await Preferences.remove({ key: STORE_KEY });
}

/** A Graph access token, renewed with the refresh token when it is close to expiring. */
export async function getNativeAccessToken(): Promise<string> {
  if (!state) throw new Error("No signed-in account. Please sign in first.");
  if (Date.now() < state.expiresAt - RENEW_EARLY_MS) return state.accessToken;

  // One renewal at a time: several uploads asking at once must not each spend
  // the refresh token, because Azure replaces it on every use.
  if (!renewing) {
    renewing = (async () => {
      try {
        await saveTokens(
          await tokenRequest({ grant_type: "refresh_token", refresh_token: state!.refreshToken }),
        );
        return state!.accessToken;
      } catch (err) {
        // A refused refresh token (expired, revoked, password changed) cannot
        // be retried into working. Forget it so the app shows sign-in again.
        if (err instanceof TokenRefused) await signOutNative();
        throw err;
      } finally {
        renewing = null;
      }
    })();
  }
  return renewing;
}

// ---- Token endpoint --------------------------------------------------------

class TokenRefused extends Error {}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const res = await CapacitorHttp.post({
    url: `${AUTHORITY}/oauth2/v2.0/token`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, ...fields }).toString(),
  });
  const data = typeof res.data === "string" ? safeJson(res.data) : res.data;
  if (res.status >= 200 && res.status < 300 && data?.access_token) return data as TokenResponse;
  const message = data?.error_description ?? "Microsoft would not complete the sign-in";
  // 400 with invalid_grant is Azure saying the code or refresh token is no
  // good. Anything else (no signal, a 5xx) is worth trying again later.
  if (res.status === 400 && data?.error === "invalid_grant") throw new TokenRefused(message);
  throw new Error(message);
}

async function saveTokens(t: TokenResponse): Promise<void> {
  const claims = t.id_token ? decodeJwtPayload(t.id_token) : null;
  const account: NativeAccount = claims
    ? { name: claims.name, username: claims.preferred_username ?? claims.email ?? "" }
    : state?.account ?? { username: "" };
  state = {
    account,
    // Azure usually returns a new refresh token; keep the old one if not.
    refreshToken: t.refresh_token ?? state?.refreshToken ?? "",
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
  await Preferences.set({ key: STORE_KEY, value: JSON.stringify(state) });
}

// ---- Redirect --------------------------------------------------------------

/** Resolves null rather than rejecting when the receiver closes the browser. */
function waitForRedirect(expectedState: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value: string | null, error?: Error) => {
      if (done) return;
      done = true;
      void urlListener.then((l) => l.remove());
      void closeListener.then((l) => l.remove());
      if (error) reject(error);
      else resolve(value);
    };

    const urlListener = App.addListener("appUrlOpen", ({ url }) => {
      if (!url.startsWith(NATIVE_REDIRECT)) return;
      // A custom scheme is not a URL the parser accepts as-is, so read the
      // query off the end rather than constructing one.
      const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      // A stale redirect from an abandoned attempt. Ignoring it is what makes
      // sign-in safe to open more than once.
      if (query.get("state") !== expectedState) return;
      const error = query.get("error_description") ?? query.get("error");
      if (error) finish(null, new Error(error));
      else finish(query.get("code"));
    });

    const closeListener = Browser.addListener("browserFinished", () => finish(null));
  });
}

// ---- Helpers ---------------------------------------------------------------

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Reads the name and email out of the ID token. Not a security check — nothing
 * here decides who may do what. The proxy validates every token it is given.
 */
function decodeJwtPayload(jwt: string): any {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(atob(part), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// PKCE: the verifier is a secret this app invents and proves it knows at the
// end. It makes a stolen authorization code useless to anyone else, and is why
// a mobile app needs no client secret baked into it.

function randomString(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64Url(a);
}

async function sha256Base64Url(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
