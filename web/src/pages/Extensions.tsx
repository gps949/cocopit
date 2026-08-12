import { useEffect, useState } from "react";
import { getJson } from "../api/usage";
import { useI18n } from "../i18n";

interface McpServer {
  name: string;
  scope: string;
  transport: string;
  detail: string;
}

interface Plugin {
  name: string;
  version: string | null;
  enabled: boolean;
}

interface ProfileExtensions {
  profileId: string;
  name: string;
  configDir: string;
  mcpServers: McpServer[];
  plugins: Plugin[];
  skills: Array<{ name: string }>;
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[15px] font-medium">{title}</h2>
        <span className="text-xs text-muted">{count}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Read-only. Adding an MCP server or installing a plugin means writing
 * ~/.claude.json, which this project treats as untouchable — those belong in the
 * CLI. What is missing here is visibility: which of these exist at all, where
 * they take effect, and whether they are on.
 */
export function Extensions() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileExtensions[] | null>(null);
  const [showAllPlugins, setShowAllPlugins] = useState(false);

  useEffect(() => {
    void getJson<{ profiles: ProfileExtensions[] }>("/api/extensions").then((r) => setProfiles(r.profiles));
  }, []);

  if (!profiles) return <div className="text-sm text-muted">{t("加载中…")}</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-[26px] font-semibold tracking-tight">{t("扩展")}</h1>
      <p className="mt-2 text-sm text-muted">
        {t("MCP、插件与技能都存放在配置目录下,因此每个 profile 各有一套。此页只读——增删请在 Claude Code 中操作。")}
      </p>

      {profiles.map((profile) => {
        const enabled = profile.plugins.filter((p) => p.enabled);
        const shown = showAllPlugins ? profile.plugins : enabled;
        return (
          <div key={profile.profileId} className="mt-6">
            {profiles.length > 1 && (
              <h2 className="text-[15px] font-medium">{t(profile.name)}</h2>
            )}

            <Section
              title={t("MCP 服务器")}
              count={profile.mcpServers.length}
              hint={t("按项目配置——只在对应工作目录下的会话中可用。")}
            >
              {profile.mcpServers.length === 0 ? (
                <p className="text-sm text-muted">{t("没有配置 MCP 服务器。")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="pb-1.5 pr-4 font-normal">{t("名称")}</th>
                        <th className="pb-1.5 pr-4 font-normal">{t("传输")}</th>
                        <th className="pb-1.5 pr-4 font-normal">{t("地址 / 命令")}</th>
                        <th className="pb-1.5 font-normal">{t("生效范围")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.mcpServers.map((server) => (
                        <tr key={`${server.scope}-${server.name}`} className="border-b border-line/60">
                          <td className="py-1.5 pr-4">{server.name}</td>
                          <td className="py-1.5 pr-4 text-xs text-muted">{server.transport}</td>
                          <td className="max-w-[22rem] truncate py-1.5 pr-4 font-mono text-xs">
                            {server.detail}
                          </td>
                          <td className="max-w-[16rem] truncate py-1.5 font-mono text-xs text-muted">
                            {server.scope}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section
              title={t("插件")}
              count={profile.plugins.length}
              hint={t("安装在配置目录下,启用状态记在 settings.json。")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">
                  {t("{on} 个已启用 / 共 {all} 个", { on: enabled.length, all: profile.plugins.length })}
                </span>
                {profile.plugins.length > enabled.length && (
                  <button
                    type="button"
                    onClick={() => setShowAllPlugins((v) => !v)}
                    className="text-xs text-accent hover:underline"
                  >
                    {showAllPlugins ? t("只看已启用") : t("显示未启用的")}
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {shown.map((plugin) => (
                  <span
                    key={plugin.name}
                    title={plugin.version ? `v${plugin.version}` : undefined}
                    className={`max-w-full truncate rounded-lg border px-2 py-1 text-xs ${
                      plugin.enabled ? "border-line" : "border-dashed border-line/70 text-muted"
                    }`}
                  >
                    {plugin.name.replace(/@.*$/, "")}
                  </span>
                ))}
              </div>
            </Section>

            <Section
              title={t("技能")}
              count={profile.skills.length}
              hint={t("配置目录下带 SKILL.md 的目录;插件也会自带技能,不计入此处。")}
            >
              {profile.skills.length === 0 ? (
                <p className="text-sm text-muted">{t("没有个人技能。")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.map((skill) => (
                    <span key={skill.name} className="rounded-lg border border-line px-2 py-1 text-xs">
                      {skill.name}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          </div>
        );
      })}
    </div>
  );
}
