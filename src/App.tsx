import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
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

  // Render Login without changing the URL when unauthenticated. With
  // HashRouter, all routes live after the # so the server-visible path
  // is always /part-photo-pwa/ (200 OK), which keeps iOS Add to Home
  // Screen happy — there's no 404 path for the install validator to hit.
  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/receive/:sessionId" element={<ReceivingWizard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
