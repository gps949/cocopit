import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./i18n";
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

export function App() {
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
