import { useState } from "react";
import { useI18n } from "../i18n";

/**
 * Shown only when the server reports that a token is required — a local-only
 * install never sees this screen.
 */
export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? t("令牌不正确"));
        return;
      }
      onAuthenticated();
    } catch {
      setError(t("连接失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6">
        <div className="font-brand text-[22px] font-medium tracking-tight">ccockpit</div>
        <p className="mt-1 text-sm text-muted">{t("此控制台需要访问令牌")}</p>

        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("访问令牌")}
          className="mt-5 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || token.length === 0}
          className="mt-4 w-full rounded-lg bg-accent px-3.5 py-2 text-sm text-white transition-colors hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
        >
          {busy ? t("加载中…") : t("进入")}
        </button>

        <p className="mt-4 text-xs text-muted">
          {t("令牌在服务器本机用「系统」页设置;忘记令牌可在服务器上删除 ~/.ccockpit/auth.json。")}
        </p>
      </form>
    </div>
  );
}
