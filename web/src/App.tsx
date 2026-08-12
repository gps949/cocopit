import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { I18nProvider } from "./i18n";
import { Login } from "./pages/Login";
import { Layout } from "./components/Layout";

// Route-level code splitting: echarts only ships with the dashboard, xterm
// only with pages that can open a terminal. The initial bundle carries just
// the shell + whichever page was requested.
//
// A tab opened before a redeploy holds HTML that names chunk files which no
// longer exist; its next navigation would 404 and render nothing. Reloading
// once picks up the new build — the guard keeps a genuinely broken deploy
// from turning into a reload loop.
const RELOADED_KEY = "cocopit-chunk-reloaded";
function lazyPage<T>(importer: () => Promise<T>, pick: (m: T) => Parameters<typeof lazy>[0] extends () => Promise<{ default: infer C }> ? C : never) {
  return lazy(() =>
    importer().then(
      (m) => {
        sessionStorage.removeItem(RELOADED_KEY);
        return { default: pick(m) };
      },
      (err) => {
        if (!sessionStorage.getItem(RELOADED_KEY)) {
          sessionStorage.setItem(RELOADED_KEY, "1");
          window.location.reload();
          return new Promise<never>(() => {}); // reloading — never settle
        }
        throw err;
      },
    ),
  );
}
const Config = lazyPage(() => import("./pages/Config"), (m) => m.Config);
const Extensions = lazyPage(() => import("./pages/Extensions"), (m) => m.Extensions);
const Dashboard = lazyPage(() => import("./pages/Dashboard"), (m) => m.Dashboard);
const Live = lazyPage(() => import("./pages/Live"), (m) => m.Live);
const Projects = lazyPage(() => import("./pages/Projects"), (m) => m.Projects);
const SessionDetail = lazyPage(() => import("./pages/SessionDetail"), (m) => m.SessionDetail);
const Sessions = lazyPage(() => import("./pages/Sessions"), (m) => m.Sessions);
const History = lazyPage(() => import("./pages/History"), (m) => m.History);
const Profiles = lazyPage(() => import("./pages/Profiles"), (m) => m.Profiles);
const System = lazyPage(() => import("./pages/System"), (m) => m.System);

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
          <Route path="/codex/profiles" element={<Profiles />} />
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
