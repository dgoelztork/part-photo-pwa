import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth-store";
import { Login } from "./screens/Login";
import { Dashboard } from "./screens/Dashboard";
import { ReceivingWizard } from "./screens/receiving/ReceivingWizard";

export function App() {
  const { initialize, isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  // Render Login at the current URL when unauthenticated — never push a
  // /login route. GitHub Pages 404s on any path that isn't a real file, and
  // iOS Add to Home Screen rejects an install whose URL returns 404. By
  // not navigating, the page stays at /part-photo-pwa/ (200 OK) and
  // installs cleanly. After login, MSAL redirects back to the same base URL.
  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/receive/:sessionId" element={<ReceivingWizard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
