import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { I18nProvider } from "./i18n";
import { Login } from "./pages/Login";
import { Layout } from "./components/Layout";
import { Config } from "./pages/Config";
import { Dashboard } from "./pages/Dashboard";
import { Live } from "./pages/Live";
import { Projects } from "./pages/Projects";
import { SessionDetail } from "./pages/SessionDetail";
import { Sessions } from "./pages/Sessions";
import { Placeholder } from "./pages/Placeholder";
import { Profiles } from "./pages/Profiles";
import { System } from "./pages/System";

type AuthState = "checking" | "required" | "ready";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  const check = () => {
    void fetch("/api/auth/status")
      .then((res) => res.json() as Promise<{ required: boolean }>)
      .then(async ({ required }) => {
        if (!required) return setAuth("ready");
        // a stored session cookie still counts as signed in
        const probe = await fetch("/api/health", { headers: { "x-probe": "1" } });
        const guarded = await fetch("/api/index/status");
        setAuth(probe.ok && guarded.status !== 401 ? "ready" : "required");
      })
      .catch(() => setAuth("ready"));
  };

  useEffect(check, []);

  if (auth === "checking") return null;
  if (auth === "required") {
    return (
      <I18nProvider>
        <Login onAuthenticated={() => setAuth("ready")} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />
          <Route path="/live" element={<Live />} />
          <Route path="/config" element={<Config />} />
          <Route path="/system" element={<System />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
