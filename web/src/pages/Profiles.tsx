import { useEffect, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { UserIcon } from "../components/icons";
import { QuotaBar, type QuotaResult } from "../components/Quota";
import { localeOf, useI18n, type Lang, type Translate } from "../i18n";
import { useProduct } from "../product";

interface ProfileView {
  id: string;
  name: string;
  color?: string;
  kind: "subscription" | "api";
  product?: "claude" | "codex";
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

async function fetchProfiles(product: "claude" | "codex"): Promise<ProfileView[]> {
  const res = await fetch(`/api/profiles?product=${product}`);
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
      chatgpt_plus: "ChatGPT Plus",
      chatgpt_pro: "ChatGPT Pro",
      chatgpt_team: "ChatGPT Team",
      chatgpt_enterprise: "ChatGPT Enterprise",
      chatgpt_free: t("免费版"),
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

/**
 * Subscription quota — the same numbers as Claude Code's /usage. The server
 * reads the OAuth token for one upstream call and returns percentages only.
 */
function QuotaSection({ profileId }: { profileId: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<QuotaResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/profiles/${profileId}/quota`)
        .then((res) => res.json())
        .then((data: QuotaResult) => {
          if (!cancelled) setResult(data);
        })
        .catch(() => {
          if (!cancelled) setResult({ status: "error" });
        });
    void load();
    // the server caches for 2 min; polling faster only re-reads that cache
    const timer = setInterval(load, 180_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [profileId]);

  if (!result || result.status === "unsupported") return null;

  const note: Partial<Record<QuotaResult["status"], string>> = {
    no_credentials: t("未读到凭据——该账号可能未在本机登录。"),
    token_expired: t("登录令牌已过期,在终端里运行一次 claude 即可刷新。"),
    rate_limited: t("官方接口暂时限流,稍后会自动重试。"),
    error: t("额度查询失败,稍后会自动重试。"),
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          {t("订阅额度")}
          <InfoHint
            text={t(
              "订阅额度与 Claude Code 里 /usage 显示的是同一数据:服务端用该账号的登录凭据向官方接口做一次查询,凭据不落盘、不进日志、也不会发给浏览器——页面只收到百分比和重置时间。",
            )}
          />
        </span>
        {result.stale && <span className="text-xs text-muted">{t("缓存值")}</span>}
      </div>
      {result.status === "ok" && result.quota ? (
        <div className="space-y-2.5">
          {result.quota.fiveHour && <QuotaBar label={t("5 小时窗口")} window={result.quota.fiveHour} />}
          {result.quota.sevenDay && <QuotaBar label={t("每周(全部模型)")} window={result.quota.sevenDay} />}
          {result.quota.sevenDayOpus && <QuotaBar label={t("每周 Opus")} window={result.quota.sevenDayOpus} />}
          {result.quota.sevenDaySonnet && (
            <QuotaBar label={t("每周 Sonnet")} window={result.quota.sevenDaySonnet} />
          )}
          {result.quota.extraUsage?.enabled && result.quota.extraUsage.utilization != null && (
            <QuotaBar
              label={t("额外用量")}
              window={{ utilization: result.quota.extraUsage.utilization, resetsAt: null }}
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">{note[result.status]}</p>
      )}
    </div>
  );
}

export function Profiles() {
  const { t, lang } = useI18n();
  const product = useProduct();
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"subscription" | "api">("subscription");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [activated, setActivated] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => fetchProfiles(product).then(setProfiles);

  useEffect(() => {
    setProfiles(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  // poll detection for subscription profiles awaiting login
  useEffect(() => {
    const pending = profiles?.some((p) => p.kind === "subscription" && !p.detection.loggedIn) ?? false;
    if (pending && !pollRef.current) {
      pollRef.current = setInterval(() => {
        for (const p of profiles ?? []) {
          // the codex default is a synthesized view, not a registry entry —
          // the list reload below re-detects it anyway
          if (p.kind === "subscription" && !p.detection.loggedIn && !(p.product === "codex" && p.id === "default")) {
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
    const kind = product === "codex" ? "subscription" : newKind;
    const body: Record<string, unknown> = { name: newName.trim(), kind, product };
    if (kind === "api") {
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
    if (!window.confirm(t("删除账号「{id}」?其登录数据目录会保留,仅移除注册条目。", { id }))) return;
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-semibold tracking-tight">{t("账号")}</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-accent-strong dark:text-ink"
        >
          {t("新建账号")}
        </button>
      </div>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
        {product === "codex"
          ? t("每个账号使用独立的 CODEX_HOME,登录互不干扰。")
          : t("每个账号使用独立的 CLAUDE_CONFIG_DIR,登录互不干扰。")}
        <InfoHint
          text={t("每个账号的会话与费用自动纳入索引,可在仪表盘按账号对比;删除账号只移除注册条目,登录数据目录保留。")}
        />
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
            {/* Codex API access lives in its own config.toml model_providers */}
            {product === "claude" && (
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
            )}
            {product === "claude" && newKind === "api" && (
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
          {(product === "codex" || newKind === "subscription") && (
            <p className="mt-3 text-xs text-muted">
              {product === "codex"
                ? t("创建后会给出登录引导命令(在你自己的终端执行 codex login);登录完成后卡片会在数秒内显示账号邮箱。")
                : t("创建后会给出登录引导命令(在你自己的终端执行 /login);登录完成后卡片会在数秒内显示账号邮箱。")}
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
                  <dt className="text-muted">{t("登录邮箱")}</dt>
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

            {p.kind === "subscription" && p.detection.loggedIn && p.product !== "codex" && (
              <QuotaSection profileId={p.id} />
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {p.kind === "subscription" && !p.detection.loggedIn && p.loginCommand && (
                <CopyButton text={p.loginCommand} label={t("复制登录命令")} />
              )}
              {/* the codex default is a synthesized view, not a registry entry */}
              {!(p.product === "codex" && p.id === "default") && (
                <button
                  type="button"
                  onClick={() => void activate(p.id)}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  {activated === p.id ? t("已写入 current-profile.sh") : t("设为 shell 默认")}
                </button>
              )}
              <InfoHint
                className="self-center"
                text={t(
                  "「设为 shell 默认」写入 ~/.cocopit/current-profile.sh,自愿在 .zshrc 中 source;仅新终端生效。会话恢复始终使用其所属账号的配置目录,与此设置无关。",
                )}
              />
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

    </div>
  );
}
