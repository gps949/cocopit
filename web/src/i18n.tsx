import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "zh" | "en";

/**
 * Source-string keyed dictionary: the Chinese text in the JSX is the key, so an
 * untranslated string degrades to itself instead of showing a raw key. Only the
 * English side needs maintaining.
 */
const EN: Record<string, string> = {
  // shell / nav
  "ccockpit": "ccockpit",
  "Claude Code 控制台": "Claude Code Console",
  "仪表盘": "Dashboard",
  "账户": "Accounts",
  "项目": "Projects",
  "会话": "Sessions",
  "实时": "Live",
  "配置": "Config",
  "系统": "System",
  "暗色": "Dark",
  "亮色": "Light",
  "跟随系统": "System theme",
  "索引中 {pct}%": "Indexing {pct}%",

  // shared
  "加载中…": "Loading…",
  "保存": "Save",
  "取消": "Cancel",
  "编辑": "Edit",
  "删除": "Delete",
  "恢复": "Restore",
  "关闭": "Close",
  "打开": "Open",
  "收起": "Collapse",
  "展开全部": "Expand all",
  "重新加载": "Reload",
  "搜索": "Search",
  "清除": "Clear",
  "加载更多": "Load more",
  "—": "—",

  // dashboard
  "7 天": "7d",
  "30 天": "30d",
  "90 天": "90d",
  "全部": "All",
  "API 等价费用": "API-equivalent cost",
  "{n} 次调用": "{n} calls",
  "输出 tokens": "Output tokens",
  "输入 {v}": "Input {v}",
  "缓存读取": "Cache reads",
  "命中率 {v}": "Hit rate {v}",
  "缓存节省": "Cache savings",
  "相对无缓存输入价": "vs uncached input price",
  "每日费用": "Daily cost",
  "按模型": "By model",
  "按项目 TOP 10": "Top 10 projects",
  "活跃时段(周 × 小时)": "Activity (weekday × hour)",
  "按账号": "By account",
  "价目校准(对照 Claude Code 官方 costUSD)": "Price calibration (vs Claude Code's costUSD)",
  "{ok}/{total} 项目·模型在容差内": "{ok}/{total} project·model pairs within tolerance",
  ",{n} 项偏差": ", {n} off",
  "模型": "Model",
  "官方": "Official",
  "我方区间": "Our range",
  "偏差": "Deviation",
  "{n} 个模型未定价({list}),其用量未计入费用。可在配置页添加价目。":
    "{n} unpriced models ({list}); their usage is excluded from cost. Add prices on the Config page.",

  // profiles
  "新建 profile": "New profile",
  "每个 profile 使用独立的 CLAUDE_CONFIG_DIR,订阅登录互不干扰;其会话与费用自动纳入索引并可在仪表盘按 profile 对比。":
    "Each profile uses its own CLAUDE_CONFIG_DIR, so subscription logins stay separate; their sessions and cost are indexed and comparable on the dashboard.",
  "名称": "Name",
  "类型": "Kind",
  "订阅账号": "Subscription",
  "API 接入": "API",
  "Base URL(可选)": "Base URL (optional)",
  "API Key / Token": "API key / token",
  "创建": "Create",
  "创建后会给出登录引导命令(在你自己的终端执行 /login);登录完成后卡片会在数秒内显示账号邮箱。":
    "You'll get a login command to run in your own terminal (/login); the card shows the account email within seconds of finishing.",
  "已登录": "Signed in",
  "待登录": "Not signed in",
  "账号": "Account",
  "组织": "Organization",
  "Key": "Key",
  "配置目录": "Config dir",
  "~/.claude(默认)": "~/.claude (default)",
  "复制登录命令": "Copy login command",
  "已复制": "Copied",
  "设为 shell 默认": "Set as shell default",
  "已写入 current-profile.sh": "Wrote current-profile.sh",
  "订阅": "Subscription",
  "API": "API",
  "「设为 shell 默认」写入 ~/.ccockpit/current-profile.sh,自愿在 .zshrc 中 source;仅新终端生效。会话恢复始终使用其所属 profile 的配置目录,与此设置无关。":
    "“Set as shell default” writes ~/.ccockpit/current-profile.sh for you to source from .zshrc; it only affects new terminals. Resuming a session always uses its own profile's config dir regardless.",
  "删除 profile「{id}」?其登录数据目录会保留,仅移除注册条目。":
    "Delete profile “{id}”? Its login data directory is kept; only the registry entry is removed.",

  // sessions
  "全文检索(中英文,至少 3 字符)": "Full-text search (3+ characters)",
  "标题": "Title",
  "消息": "Messages",
  "费用": "Cost",
  "最近": "Last active",
  "没有匹配的会话": "No matching sessions",
  "{n} 子代理": "{n} subagents",
  "已按项目筛选": "Filtered by project",
  "{n} 天前": "{n}d ago",

  // session detail
  "← 会话列表": "← All sessions",
  "在终端中恢复": "Resume in terminal",
  "会话运行在 tmux 中,关闭页面不会中断;重新打开即可继续。终端内 exit 退出后会话结束。":
    "The session runs in tmux — closing this page won't interrupt it; reopen to continue. Typing exit in the terminal ends it.",
  "子代理": "Subagents",
  "加载更多消息": "Load newer messages",
  "加载更早的消息": "Load older messages",
  "跳到最新": "Jump to latest",
  "对话大纲({n})": "Outline ({n})",
  "你": "You",
  "Claude": "Claude",
  "记录": "Record",
  "思考": "Thinking",
  "工具": "Tool",
  "结果": "Result",
  "内容过大({size}),已跳过。": "Content too large ({size}); skipped.",
  "仍要加载": "Load anyway",
  "只看对话": "Conversation only",
  "显示思考": "Show thinking",
  "显示元数据": "Show metadata",
  "斜杠命令 {name}": "Slash command {name}",
  "命令输出": "Command output",
  "系统提醒": "System reminder",
  "附件": "Attachment",
  "{n} 条元数据记录": "{n} metadata records",
  "出错": "Error",
  "{n} 行": "{n} lines",
  "注入上下文": "injected context",

  // projects
  "每个项目对应一个工作目录。可直接在此新建会话——命令由服务端构造并运行在 tmux 中,浏览器只发送项目 ID。":
    "Each project maps to a working directory. Start a session here — the command is built server-side and runs in tmux; the browser only sends a project id.",
  "目录": "Directory",
  "新建会话": "New session",
  "收起终端(会话继续运行)": "Hide terminal (session keeps running)",

  // live
  "本机正在运行的 Claude Code 进程,以及 ccockpit 管理的 tmux 终端(每 3 秒刷新)。":
    "Claude Code processes running on this machine, plus ccockpit's tmux terminals (refreshed every 3s).",
  "运行中的会话({n})": "Running sessions ({n})",
  "当前没有运行中的会话。": "No sessions are running.",
  "运行中": "running",
  "查看会话": "View session",
  "ccockpit 终端({n})": "ccockpit terminals ({n})",
  "未检测到 tmux,Web 终端不可用。": "tmux not found — the web terminal is unavailable.",
  "还没有终端。可在会话详情页「在终端中恢复」,或在项目页新建会话。":
    "No terminals yet. Use “Resume in terminal” on a session, or start one from Projects.",
  "已连接": "attached",
  "空闲": "idle",
  "已结束的注册项({n})": "Ended registry entries ({n})",
  "进程已退出但注册文件仍在(崩溃或 PID 已被复用),仅供排查。":
    "The process exited but its registry file remains (crash or recycled pid) — for troubleshooting only.",
  "关闭终端 {name}?其中运行的会话会被结束。": "Close terminal {name}? The session running in it will end.",

  // terminal
  "连接中…": "Connecting…",
  "此控制台需要访问令牌": "This console requires an access token",
  "访问令牌": "Access token",
  "进入": "Enter",
  "令牌不正确": "Incorrect token",
  "连接失败": "Connection failed",
  "令牌在服务器本机用「系统」页设置;忘记令牌可在服务器上删除 ~/.ccockpit/auth.json。": "Set the token from the System page on the server itself; if it is lost, delete ~/.ccockpit/auth.json there.",
  "远程访问": "Remote access",
  "未设置访问令牌。ccockpit 绑定 127.0.0.1,本机使用无需登录;若通过反代对外暴露,请设置令牌。": "No access token set. ccockpit binds to 127.0.0.1, so local use needs no login; set a token before exposing it through a reverse proxy.",
  "已启用访问令牌。远程访问需要先登录。": "Access token enabled — remote access requires signing in.",
  "设置令牌": "Set token",
  "清除令牌": "Clear token",
  "新令牌(至少 8 位)": "New token (8+ characters)",
  "仅可在服务器本机设置": "Can only be set from the server itself",
  "已断开": "Disconnected",
  "错误": "Error",

  // config
  "配置文件": "Config file",
  "用户级": "User",
  "项目级": "Project",
  "(尚不存在,保存后创建)": "(does not exist yet; saving creates it)",
  "检测到 {n} 个运行中的 Claude Code 会话。它们退出时可能回写该文件覆盖你的修改;修改前建议先退出,或保存后用备份恢复。":
    "{n} Claude Code sessions are running. They may rewrite this file on exit and overwrite your changes — quit them first, or restore from a backup afterwards.",
  "JSON 错误:{msg}": "JSON error: {msg}",
  "将修改 {n} 个键:": "Will change {n} key(s): ",
  "已保存": "Saved",
  "已备份 {id}": "Backed up as {id}",
  "加载最新": "Load latest",
  "价目表(USD / 百万 tokens)": "Pricing (USD per million tokens)",
  "版本 v{v} · 修改任意行即生成用户覆盖,保存后全量重算历史费用":
    "Version v{v} · editing any row creates a user override; saving re-prices all history",
  "重算中…": "Recalculating…",
  "已重算完成": "Recalculation complete",
  "保存失败": "Save failed",
  "清除全部覆盖": "Clear all overrides",
  "保存并重算": "Save and re-price",
  "模型前缀": "Model prefix",
  "输入": "Input",
  "输出": "Output",
  "缓存读": "Cache read",
  "写 5m": "Write 5m",
  "写 1h": "Write 1h",
  "来源": "Source",
  "默认": "default",
  "用户覆盖": "override",
  "新增": "new",
  "新增模型前缀,如 deepseek-v4": "New model prefix, e.g. deepseek-v4",
  "添加条目": "Add entry",
  "对照 LiteLLM 社区价格库": "Compare with the LiteLLM community catalog",
  "对比": "Compare",
  "刷新": "Refresh",
  "数据更新于 {when}": "Fetched {when}",
  "已对比 {n} 个相关模型,{d} 处差异": "Compared {n} relevant models · {d} differ",
  "我方": "Ours",
  "未定价": "unpriced",
  "采用": "Adopt",
  "为未定价模型(如 deepseek)补价后,其用量将计入费用":
    "Pricing an unpriced model (e.g. deepseek) brings its usage into cost totals",

  // system
  "索引状态": "Index status",
  "增量扫描": "Incremental scan",
  "完全重建": "Full rebuild",
  "完全重建将清空索引后重扫全部数据,继续?": "A full rebuild clears the index and rescans everything. Continue?",
  "连接服务中…": "Connecting…",
  "扫描中": "Scanning",
  "文件": "Files",
  "字节": "Bytes",
  "解析错误": "Parse errors",
  "上次完成": "Last finished",
  "磁盘治理": "Disk cleanup",
  "保留天数": "Retention days",
  "预览": "Preview",
  "执行删除": "Delete",
  "{n} 个会话正在运行,其文件版本备份不会被清理。":
    "{n} sessions are running; their file-history is excluded from cleanup.",
  "受保护(永不清理):": "Protected (never cleaned):",
  "预览:将删除 {n} 项,释放 {size}": "Preview: would remove {n} item(s), freeing {size}",
  "已删除 {n} 项,释放 {size}": "Removed {n} item(s), freed {size}",
  "…还有 {n} 项": "…and {n} more",
  "确认删除 {n} 项?此操作不可撤销。": "Delete {n} item(s)? This cannot be undone.",
  "配置备份({n})": "Config backups ({n})",
  "还没有备份。修改配置时会自动创建。": "No backups yet — one is created whenever you save a config change.",
  "恢复该备份?当前内容会先被备份,可再回滚。":
    "Restore this backup? The current content is backed up first, so this stays reversible.",
  "已恢复": "Restored",
  "恢复失败": "Restore failed",
  "调试日志": "Debug logs",
  "文件版本备份": "File history",
  "会话环境目录": "Session env dirs",
  "插件临时克隆": "Plugin temp clones",
  "Shell 快照": "Shell snapshots",
  "任务列表": "Todo lists",
  "会话记录": "Transcripts",
  "活跃会话注册表": "Live session registry",

  // placeholder
  "此模块尚未交付,将在 {phase} 上线。索引层已就绪,数据在后台持续更新。":
    "Not delivered yet — coming in {phase}. The index layer is live and updating in the background.",
};

interface I18nValue {
  "lang": Lang;
  "setLang": (lang: Lang) => void;
  "t": (source: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = "ccockpit-lang";

function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in params ? String(params[key]) : all));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const t = useCallback(
    (source: string, params?: Record<string, string | number>) =>
      interpolate(lang === "en" ? (EN[source] ?? source) : source, params),
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang: setLangState, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

/** Locale for Intl formatting (dates, numbers). */
export function localeOf(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en-US";
}
