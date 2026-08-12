import { useEffect, useState } from "react";
import { getJson } from "../api/usage";
import { InfoHint } from "../components/InfoHint";
import { useI18n } from "../i18n";

interface CodexConfigView {
  path: string;
  content: string | null;
  profiles: string[];
}

/**
 * Codex configuration, read-only. Editing TOML safely is a different project
 * from editing JSON settings (comments, table syntax), and Codex's own CLI is
 * the right tool for changes — this page answers "what is it running with".
 */
export function CodexConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<CodexConfigView | null>(null);

  useEffect(() => {
    void getJson<CodexConfigView>("/api/codex/config").then(setConfig);
  }, []);

  if (!config) return <div className="text-sm text-muted">{t("加载中…")}</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-[26px] font-semibold tracking-tight">{t("配置")}</h1>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
        {t("Codex 的配置只读展示;修改请在 Codex CLI 中进行。")}
        <InfoHint text={t("密钥类字段(key/token/secret)已打码;env 表中的凭据不会离开服务器。")} />
      </p>

      <section className="mt-5 rounded-2xl border border-line bg-panel p-5">
        <h2 className="inline-flex items-center gap-1.5 text-[15px] font-medium">
          {t("配置方案")}
          <InfoHint
            text={t(
              "Codex 自带方案机制:<名称>.config.toml 以 codex --profile <名称> 叠加在 config.toml 之上——相当于 Claude 侧的「配置方案」,但由 Codex 原生支持。",
            )}
          />
        </h2>
        {config.profiles.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {t("还没有配置方案。在 CODEX_HOME 下创建 <名称>.config.toml 即可,用 codex --profile <名称> 启用。")}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {config.profiles.map((name) => (
              <span key={name} className="rounded-lg border border-line px-2 py-1 font-mono text-xs">
                {name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-[15px] font-medium">config.toml</h2>
        <div className="mt-1 font-mono text-xs text-muted">{config.path}</div>
        {config.content === null ? (
          <p className="mt-3 text-sm text-muted">{t("文件不存在。")}</p>
        ) : (
          <pre className="mt-3 max-h-[32rem] overflow-auto rounded-xl border border-line bg-bg p-4 font-mono text-xs leading-relaxed">
            {config.content}
          </pre>
        )}
      </section>
    </div>
  );
}
