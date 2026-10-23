import {
  PublicClientApplication,
  type AuthenticationResult,
  type AccountInfo,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";
import { Capacitor } from "@capacitor/core";
import { MSAL_CONFIG, GRAPH_SCOPES, TENANT_DOMAIN_HINT } from "../config";
import {
  initNativeAuth,
  getNativeAccount,
  signInNative,
  signOutNative,
  getNativeAccessToken,
} from "./auth-native";

// Inside the native phone app MSAL cannot sign in (see auth-native.ts), so
// every function below hands over to the native sign-in first. The browser
// build never takes that path.
const native = Capacitor.isNativePlatform();

/** The two fields the app reads from an account, shaped like MSAL's. */
function asAccount(a: { name?: string; username: string } | null): AccountInfo | null {
  return a ? ({ name: a.name, username: a.username } as AccountInfo) : null;
}

let msalInstance: PublicClientApplication | null = null;

export async function initAuth(): Promise<PublicClientApplication | null> {
  if (native) {
    await initNativeAuth();
    return null;
  }
  if (msalInstance) return msalInstance;

  msalInstance = new PublicClientApplication(MSAL_CONFIG);
  await msalInstance.initialize();

  // Handle redirect response (for iOS standalone PWA)
  const redirectResult = await msalInstance.handleRedirectPromise();
  if (redirectResult?.account) {
    msalInstance.setActiveAccount(redirectResult.account);
  }

  return msalInstance;
}

export function getAccount(): AccountInfo | null {
  if (native) return asAccount(getNativeAccount());
  if (!msalInstance) return null;
  // Check active account first (set during login), then fall back to cached accounts
  const active = msalInstance.getActiveAccount();
  if (active) return active;
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
    return accounts[0];
  }
  return null;
}

export async function signIn(): Promise<AccountInfo | null> {
  if (native) return asAccount(await signInNative());
  const msal = (await initAuth())!;

  // Use redirect flow on iOS (popups are blocked in standalone PWA mode)
  if (isIOSStandalone()) {
    await msal.loginRedirect({ scopes: GRAPH_SCOPES, domainHint: TENANT_DOMAIN_HINT });
    return null; // Page will redirect
  }

  try {
    const result: AuthenticationResult = await msal.loginPopup({
      scopes: GRAPH_SCOPES,
      domainHint: TENANT_DOMAIN_HINT,
    });
    if (result.account) {
      msal.setActiveAccount(result.account);
    }
    return result.account;
  } catch {
    // Fallback to redirect if popup fails
    await msal.loginRedirect({ scopes: GRAPH_SCOPES, domainHint: TENANT_DOMAIN_HINT });
    return null;
  }
}

export async function signOut(): Promise<void> {
  if (native) return signOutNative();
  const msal = (await initAuth())!;
  const account = getAccount();
  if (account) {
    await msal.logoutPopup({ account }).catch(() => {
      msal.logoutRedirect({ account });
    });
  }
}

export async function getAccessToken(): Promise<string> {
  if (native) return getNativeAccessToken();
  const msal = (await initAuth())!;
  const account = getAccount();

  if (!account) {
    throw new Error("No signed-in account. Please sign in first.");
  }

  try {
    const result = await msal.acquireTokenSilent({
      scopes: GRAPH_SCOPES,
      account,
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      if (isIOSStandalone()) {
        await msal.acquireTokenRedirect({
          scopes: GRAPH_SCOPES,
          account,
          domainHint: TENANT_DOMAIN_HINT,
        });
        throw new Error("Redirecting for authentication...");
      }
      const result = await msal.acquireTokenPopup({
        scopes: GRAPH_SCOPES,
        account,
        domainHint: TENANT_DOMAIN_HINT,
      });
      return result.accessToken;
    }
    throw error;
  }
}

function isIOSStandalone(): boolean {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as any).standalone === true);
  return isIOS && isStandalone;
}
