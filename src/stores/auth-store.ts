import { create } from "zustand";
import {
  initAuth,
  getAccount,
  signIn as msalSignIn,
  signOut as msalSignOut,
  getAccessToken,
} from "../lib/auth";
import { getUserDisplayName } from "../lib/graph-client";

interface AuthStore {
  isAuthenticated: boolean;
  userName: string;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()((set) => ({
  isAuthenticated: false,
  userName: "",
  isLoading: true,
  error: null,

  initialize: async () => {
    try {
      await initAuth();
      const account = getAccount();
      if (account) {
        await getAccessToken();
        let name = account.name ?? account.username ?? "User";
        try {
          name = await getUserDisplayName();
        } catch {
          // Use account name as fallback
        }
        set({ isAuthenticated: true, userName: name, isLoading: false });
      } else {
        set({ isAuthenticated: false, isLoading: false });
      }
    } catch {
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  signIn: async () => {
    set({ error: null });
    try {
      const account = await msalSignIn();
      if (account) {
        let name = account.name ?? account.username ?? "User";
        try {
          name = await getUserDisplayName();
        } catch {
          // Use account name as fallback
        }
        set({ isAuthenticated: true, userName: name });
        return true;
      }
      return false; // Redirect flow — page will reload
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Sign in failed" });
      return false;
    }
  },

  signOut: async () => {
    try {
      await msalSignOut();
    } catch {
      // Ignore sign-out errors
    }
    set({ isAuthenticated: false, userName: "" });
  },
}));
