import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { I18nProvider } from "./i18n";
import { Login } from "./pages/Login";
import { Layout } from "./components/Layout";

// Route-level code splitting: echarts only ships with the dashboard, xterm
// only with pages that can open a terminal. The initial bundle carries just
// the shell + whichever page was requested.
const Config = lazy(() => import("./pages/Config").then((m) => ({ default: m.Config })));
const Extensions = lazy(() => import("./pages/Extensions").then((m) => ({ default: m.Extensions })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Live = lazy(() => import("./pages/Live").then((m) => ({ default: m.Live })));
const Projects = lazy(() => import("./pages/Projects").then((m) => ({ default: m.Projects })));
const SessionDetail = lazy(() => import("./pages/SessionDetail").then((m) => ({ default: m.SessionDetail })));
const Sessions = lazy(() => import("./pages/Sessions").then((m) => ({ default: m.Sessions })));
const History = lazy(() => import("./pages/History").then((m) => ({ default: m.History })));
const Profiles = lazy(() => import("./pages/Profiles").then((m) => ({ default: m.Profiles })));
const System = lazy(() => import("./pages/System").then((m) => ({ default: m.System })));

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
      <Suspense fallback={null}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />
          <Route path="/history" element={<History />} />
          {/* the Codex view of the same console: same components, product from the URL */}
          <Route path="/codex" element={<Navigate to="/codex/dashboard" replace />} />
          <Route path="/codex/dashboard" element={<Dashboard />} />
          <Route path="/codex/projects" element={<Projects />} />
          <Route path="/codex/sessions" element={<Sessions />} />
          <Route path="/codex/sessions/:id" element={<SessionDetail />} />
          <Route path="/codex/history" element={<History />} />
          <Route path="/live" element={<Live />} />
          <Route path="/config" element={<Config />} />
          <Route path="/extensions" element={<Extensions />} />
          <Route path="/system" element={<System />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      </Suspense>
      </BrowserRouter>
    </I18nProvider>
  );
}
