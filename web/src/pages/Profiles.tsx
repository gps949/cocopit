import { useEffect, useRef, useState } from "react";
import { UserIcon } from "../components/icons";
import { localeOf, useI18n, type Lang, type Translate } from "../i18n";

interface ProfileView {
  id: string;
  name: string;
  color?: string;
  kind: "subscription" | "api";
  configDir: string | null;
  api?: { baseUrl?: string; model?: string; authKind: string; secret: string };
  lastDetected?: { email?: string; orgName?: string; at: number };
  loginCommand?: string;
  detection: {
    loggedIn: boolean;
    email?: string;
    displayName?: string;
    orgName?: string;
    orgType?: string;
    orgRole?: string;
    billingType?: string;
    subscriptionCreatedAt?: string;
    accountCreatedAt?: string;
    trialEndsAt?: string | null;
    extraUsageEnabled?: boolean;
    rateLimitTier?: string;
  };
}

async function fetchProfiles(): Promise<ProfileView[]> {
  const res = await fetch("/api/profiles");
  return ((await res.json()) as { profiles: ProfileView[] }).profiles;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {copied ? t("已复制") : label}
    </button>
  );
}

/** claude_pro / claude_max_5x / … → something a person recognizes. */
function planLabel(d: { orgType?: string; billingType?: string }, t: Translate): string | null {
  const type = d.orgType;
  if (type) {
    const named: Record<string, string> = {
      claude_pro: "Claude Pro",
      claude_max: "Claude Max",
      claude_max_5x: "Claude Max 5×",
      claude_max_20x: "Claude Max 20×",
      claude_team: "Claude Team",
      claude_enterprise: "Claude Enterprise",
      freeform: t("免费版"),
    };
    if (named[type]) return named[type]!;
    return type.replace(/_/g, " ");
  }
  if (d.billingType === "stripe_subscription") return t("订阅");
  return null;
}

function fmtDate(iso: string, lang: Lang): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleDateString(localeOf(lang), { year: "numeric", month: "short", day: "numeric" });
}

export function Profiles() {
  const { t, lang } = useI18n();
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"subscription" | "api">("subscription");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [activated, setActivated] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => fetchProfiles().then(setProfiles);

  useEffect(() => {
    void load();
  }, []);

  // poll detection for subscription profiles awaiting login
  useEffect(() => {
    const pending = profiles?.some((p) => p.kind === "subscription" && !p.detection.loggedIn) ?? false;
    if (pending && !pollRef.current) {
      pollRef.current = setInterval(() => {
        for (const p of profiles ?? []) {
          if (p.kind === "subscription" && !p.detection.loggedIn) {
            void fetch(`/api/profiles/${p.id}/detect`);
          }
        }
        void load();
      }, 5000);
    }
    if (!pending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [profiles]);

  async function create() {
    if (!newName.trim()) return;
    const body: Record<string, unknown> = { name: newName.trim(), kind: newKind };
    if (newKind === "api") {
      if (!apiSecret.trim()) return;
      body.api = { baseUrl: apiBaseUrl.trim() || undefined, authKind: "auth_token", secret: apiSecret.trim() };
    }
    const res = await fetch("/api/profiles", { method: "POST", body: JSON.stringify(body) });
    if (res.ok) {
      setCreating(false);
      setNewName("");
      setApiBaseUrl("");
      setApiSecret("");
      void load();
    }
  }

  async function activate(id: string) {
    const res = await fetch(`/api/profiles/${id}/activate`, { method: "POST" });
    if (res.ok) {
      setActivated(id);
      setTimeout(() => setActivated(null), 4000);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("删除 profile「{id}」?其登录数据目录会保留,仅移除注册条目。", { id }))) return;
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-semibold tracking-tight">{t("账户")}</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-accent-strong dark:text-ink"
        >
          {t("新建 profile")}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        {t("每个 profile 使用独立的 CLAUDE_CONFIG_DIR,订阅登录互不干扰;其会话与费用自动纳入索引并可在仪表盘按 profile 对比。")}
      </p>
      {/* asked for repeatedly, so say why it is absent instead of leaving a gap */}
      <p className="mt-1.5 text-xs text-muted">
        {t("5 小时 / 每周额度用量与重置时间不在任何本地文件里——它们由 API 实时返回,凭据只存在于系统钥匙串,cocopit 不读取。请在 Claude Code 中用 /usage 查看。仪表盘的费用统计是按官方价目对本地记录的换算,与订阅额度是两回事。")}
      </p>

      {creating && (
        <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <div className="mb-1 text-xs text-muted">{t("名称")}</div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("如 Work")}
                className="w-44 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-xs text-muted">{t("类型")}</div>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as "subscription" | "api")}
                className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
              >
                <option value="subscription">{t("订阅账号")}</option>
                <option value="api">{t("API 接入")}</option>
              </select>
            </label>
            {newKind === "api" && (
              <>
                <label className="text-sm">
                  <div className="mb-1 text-xs text-muted">{t("Base URL(可选)")}</div>
                  <input
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://…/anthropic"
                    className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm sm:w-64"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-xs text-muted">API Key / Token</div>
                  <input
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    type="password"
                    className="w-52 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
                  />
                </label>
              </>
            )}
            <button
              type="button"
              onClick={() => void create()}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong dark:text-ink"
            >
              {t("创建")}
            </button>
          </div>
          {newKind === "subscription" && (
            <p className="mt-3 text-xs text-muted">
              {t("创建后会给出登录引导命令(在你自己的终端执行 /login);登录完成后卡片会在数秒内显示账号邮箱。")}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {profiles?.map((p) => (
          <div key={p.id} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-8 items-center justify-center rounded-full"
                  style={{ backgroundColor: p.color ?? "var(--accent-soft)" }}
                >
                  <UserIcon className="size-4 text-accent" />
                </span>
                <div>
                  <div className="font-medium">{t(p.name)}</div>
                  <div className="text-xs text-muted">
                    {p.kind === "subscription" ? t("订阅") : "API"} · {p.id}
                  </div>
                </div>
              </div>
              {p.detection.loggedIn ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent">{t("已登录")}</span>
              ) : (
                <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{t("待登录")}</span>
              )}
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              {p.detection.email && (
                <div className="flex justify-between">
                  <dt className="text-muted">{t("账号")}</dt>
                  <dd>{p.detection.email}</dd>
                </div>
              )}
              {planLabel(p.detection, t) && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t("订阅")}</dt>
                  <dd className="min-w-0 text-right">{planLabel(p.detection, t)}</dd>
                </div>
              )}
              {p.detection.subscriptionCreatedAt && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t("订阅开始")}</dt>
                  <dd className="min-w-0 text-right">{fmtDate(p.detection.subscriptionCreatedAt, lang)}</dd>
                </div>
              )}
              {p.detection.trialEndsAt && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t("试用到期")}</dt>
                  <dd className="min-w-0 text-right">{fmtDate(p.detection.trialEndsAt, lang)}</dd>
                </div>
              )}
              {p.detection.extraUsageEnabled != null && p.detection.loggedIn && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t("额外用量")}</dt>
                  <dd className="min-w-0 text-right">
                    {p.detection.extraUsageEnabled ? t("已开启") : t("未开启")}
                  </dd>
                </div>
              )}
              {p.detection.orgName && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t("组织")}</dt>
                  <dd className="min-w-0 truncate text-right">{p.detection.orgName}</dd>
                </div>
              )}
              {p.api?.baseUrl && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">Base URL</dt>
                  <dd className="truncate font-mono text-xs">{p.api.baseUrl}</dd>
                </div>
              )}
              {p.api && (
                <div className="flex justify-between">
                  <dt className="text-muted">Key</dt>
                  <dd className="font-mono text-xs">{p.api.secret}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted">{t("配置目录")}</dt>
                <dd className="truncate font-mono text-xs">{p.configDir ?? t("~/.claude(默认)")}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              {p.kind === "subscription" && !p.detection.loggedIn && p.loginCommand && (
                <CopyButton text={p.loginCommand} label={t("复制登录命令")} />
              )}
              <button
                type="button"
                onClick={() => void activate(p.id)}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                {activated === p.id ? "已写入 current-profile.sh" : t("设为 shell 默认")}
              </button>
              {p.id !== "default" && (
                <button
                  type="button"
                  onClick={() => void remove(p.id)}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-danger transition-colors hover:bg-hover"
                >
                  {t("删除")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        {t("「设为 shell 默认」写入 ~/.cocopit/current-profile.sh,自愿在 .zshrc 中 source;仅新终端生效。会话恢复始终使用其所属 profile 的配置目录,与此设置无关。")}
      </p>
    </div>
  );
}
