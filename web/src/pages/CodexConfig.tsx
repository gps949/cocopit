import { useEffect, useState } from "react";
import { getJson } from "../api/usage";
import { InfoHint } from "../components/InfoHint";
import { useI18n } from "../i18n";

interface CodexConfigView {
  path: string;
  content: string | null;
  profiles: string[];
}

interface CodexProfile {
  name: string;
  content: string;
}

/**
 * Codex configuration. config.toml itself stays read-only — the CLI owns it,
 * comments and all. Config profiles are the writable surface: opt-in overlay
 * files whose blast radius is only the sessions that ask for them, so they
 * get the full create/edit/delete lifecycle with TOML validation and backups.
 */
export function CodexConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<CodexConfigView | null>(null);
  const [profiles, setProfiles] = useState<CodexProfile[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    void getJson<CodexConfigView>("/api/codex/config").then(setConfig);
    void getJson<{ profiles: CodexProfile[] }>("/api/codex/profiles").then((r) => setProfiles(r.profiles));
  };

  useEffect(load, []);

  async function save(name: string, content: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/codex/profiles/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setNotice(t("已保存「{name}」;用 codex --profile {name} 启用。", { name }));
    setEditing(null);
    setCreating(false);
    setNewName("");
    load();
  }

  async function remove(name: string) {
    if (!window.confirm(t("删除方案「{name}」?其内容会先存入备份,可从系统页恢复。", { name }))) return;
    setError(null);
    await fetch(`/api/codex/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
    load();
  }

  if (!config || !profiles) return <div className="text-sm text-muted">{t("加载中…")}</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-[26px] font-semibold tracking-tight">{t("配置")}</h1>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
        {t("配置方案可在此管理;config.toml 本体只读。")}
        <InfoHint
          text={t(
            "方案是叠加层文件,只影响显式用 --profile 启用的会话,所以可以放心在这里编辑;config.toml 是 CLI 的主配置、含手写注释,改坏影响所有会话,故保持只读。密钥类字段展示时已打码。",
          )}
        />
      </p>

      <section className="mt-5 rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1.5 text-[15px] font-medium">
            {t("配置方案")}
            <InfoHint
              text={t(
                "Codex 自带方案机制:<名称>.config.toml 以 codex --profile <名称> 叠加在 config.toml 之上——相当于 Claude 侧的「配置方案」,但由 Codex 原生支持。",
              )}
            />
          </h2>
          <button
            type="button"
            onClick={() => {
              setCreating((v) => !v);
              setEditing(null);
              setDraft('# overlay keys, e.g.\n# model = "gpt-5.3-codex"\n# approval_policy = "never"\n');
            }}
            className="rounded-lg bg-accent px-3 py-1 text-sm text-white hover:bg-accent-strong dark:text-ink"
          >
            {t("新建方案")}
          </button>
        </div>

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {notice && <p className="mt-2 text-sm text-ok">{notice}</p>}

        {creating && (
          <div className="mt-3 rounded-xl border border-line p-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("方案名(字母/数字/连字符)")}
              className="w-56 rounded-lg border border-line bg-bg px-3 py-1.5 font-mono text-sm"
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              spellCheck={false}
              className="mt-2 w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed"
            />
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() => void save(newName.trim(), draft)}
              className="mt-2 rounded-lg bg-accent px-3 py-1 text-sm text-white hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
            >
              {t("创建")}
            </button>
          </div>
        )}

        {profiles.length === 0 && !creating ? (
          <p className="mt-3 text-sm text-muted">
            {t("还没有配置方案。新建一个,然后用 codex --profile <名称> 启用,或在项目页新建会话时选择。")}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {profiles.map((profile) => (
              <div key={profile.name} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{profile.name}</span>
                  <code className="rounded bg-hover px-1.5 py-0.5 text-xs text-muted">
                    codex --profile {profile.name}
                  </code>
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (editing === profile.name) {
                          setEditing(null);
                        } else {
                          setEditing(profile.name);
                          setCreating(false);
                          setDraft(profile.content);
                        }
                      }}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-ink"
                    >
                      {editing === profile.name ? t("收起") : t("编辑")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(profile.name)}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs text-danger hover:bg-hover"
                    >
                      {t("删除")}
                    </button>
                  </div>
                </div>
                {editing === profile.name && (
                  <div className="mt-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={10}
                      spellCheck={false}
                      className="w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed"
                    />
                    <button
                      type="button"
                      onClick={() => void save(profile.name, draft)}
                      className="mt-2 rounded-lg bg-accent px-3 py-1 text-sm text-white hover:bg-accent-strong dark:text-ink"
                    >
                      {t("保存(先校验 TOML,写前自动备份)")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="inline-flex items-center gap-1.5 text-[15px] font-medium">
          config.toml
          <InfoHint text={t("密钥类字段(key/token/secret)已打码;env 表中的凭据不会离开服务器。")} />
        </h2>
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
