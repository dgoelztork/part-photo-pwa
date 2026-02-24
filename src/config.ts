// Azure AD App Registration settings
// Replace AZURE_CLIENT_ID with your Application (client) ID from Azure portal
export const MSAL_CONFIG = {
  auth: {
    clientId: "8d67b410-ec72-469c-ab0a-3b4c60ee8738",
    authority: "https://login.microsoftonline.com/6dea7009-0c2d-49ce-9887-fb702c17447c",
    redirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: {
    cacheLocation: "localStorage" as const,
    storeAuthStateInCookie: false,
  },
};

export const GRAPH_SCOPES = ["Files.ReadWrite", "User.Read"];
export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

// Default OneDrive paths (user can change in settings)
export const DEFAULT_CSV_PATH = "/Parts Photos/parts-catalog.csv";
export const DEFAULT_PHOTO_FOLDER = "/Parts Photos";
