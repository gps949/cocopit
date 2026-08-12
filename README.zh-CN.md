<p align="center">
  <img src="docs/logo.png" alt="可可坑" width="128" />
</p>

<h1 align="center">cocopit · 可可坑</h1>

<p align="center">
  <a href="https://www.anthropic.com/claude-code">Claude Code</a> 的本地优先 Web 控制台——用量费用统计、会话浏览检索、多账号管理、配置与权限编辑、内置 Web 终端。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/manual.zh-CN.md">用户手册</a> ·
  <a href="docs/manual.md">User manual</a>
</p>

---

## 能做什么

- **仪表盘**——API 等价费用、tokens、缓存效率(命中率用的是诚实口径:缓存写入算未命中)、每日费用柱图、周×小时热力图、按模型/项目/账号拆分。按日按小时的分桶跟随**你浏览器的时区**,而不是服务器的。
- **订阅额度**——与 Claude Code 里 `/usage` 相同的 5 小时/每周窗口用量,显示在仪表盘和账号页。凭据不出服务端进程,永远不会发给浏览器。
- **会话**——全库全文检索(支持中文)、按项目/账号/时间筛选、任意大小记录的窗口式阅读、对话大纲、会话内搜索、子代理记录、回退分支可见、跨文件的续接关系。
- **提示词历史**——你输入过的每一条提示词,可搜索,可跳回所属会话。
- **账号**——多个订阅登录(各自独立的 `CLAUDE_CONFIG_DIR`)与 API Key 接入并存;费用按账号归属;任何会话可在任何账号下恢复。
- **Web 终端**——在浏览器里恢复会话或新开会话。会话跑在服务器的 tmux 里:关掉标签页不会中断,重连即重新附着。触屏设备有 Esc / Tab / ^C / 方向键按键条和剪贴板粘贴。
- **配置**——编辑 `settings.json`(用户级与项目级),带校验、改动 diff 预览、写前自动备份与并发冲突检测;具名配置方案;价目表编辑器与 LiteLLM 价格对照。
- **系统**——索引状态、磁盘占用分类与安全清理(先 dry-run,活跃会话永远排除)、配置备份浏览与差异对比恢复、远程访问设置。

一切都派生自 Claude Code 自己的文件(`~/.claude/`)。除了你在配置页显式保存的 settings 文件,cocopit 从不写入它们——而每次这样的写入之前都有备份。

## 快速开始

只需要 [Bun](https://bun.sh)(Web 终端功能还需要 `tmux`),没有其他运行时依赖——服务端只用 Bun 内置能力。

```bash
# 免安装,直接从 registry 运行
bunx cocopit

# 或全局安装
bun install -g cocopit
cocopit
```

然后打开 http://127.0.0.1:7433。

```bash
cocopit --port 8080            # 指定端口(也可用 COCOPIT_PORT 环境变量或 config.json)
cocopit --host 0.0.0.0         # 监听回环之外(需要先设访问令牌,见下)
cocopit --help
```

cocopit 像普通服务器一样前台运行。想放到后台:

```bash
nohup cocopit > ~/.cocopit/cocopit.log 2>&1 &     # 普通后台任务
tmux new -d -s cocopit cocopit                     # 或者跑在 tmux 里
```

### 从源码运行

```bash
git clone https://github.com/gps949/cocopit.git && cd cocopit
bun install
bun run build        # 构建前端
bun run start        # 或者:bun bin/cocopit.ts --port 8080
```

首次启动会全量扫描 `~/.claude/projects` 建 SQLite 索引(5GB 历史约 40 秒;进度在页面实时显示,不用等扫完就能用)。之后每次启动只增量扫描,通常 1 秒内完成。

开发时用 `bun run dev`:后端 watch 模式 + Vite 热更新,访问 http://127.0.0.1:5173。

```bash
bun test             # 运行测试
```

## 数据在哪

| 路径 | 内容 | 读写 |
| --- | --- | --- |
| `~/.claude/` | Claude Code 自己的数据:会话记录、配置、插件 | **只读**,仅在配置页显式保存时写 `settings.json` |
| `~/.claude.json` | Claude Code 主配置 | **永不写入**,只读取展示 |
| `~/.cocopit/index.db` | cocopit 的索引(SQLite) | 派生数据——可随时删除,重启后重建 |
| `~/.cocopit/config.json` | cocopit 自身设置(端口、监听地址等) | 由系统页写入 |
| `~/.cocopit/auth.json` | 访问令牌的 sha256 哈希 | 由系统页写入 |
| `~/.cocopit/backups/` | cocopit 碰过的每个配置文件的写前备份 | 在系统页恢复 |

## 远程访问

默认只监听 `127.0.0.1`。要从别的机器访问,**先在系统页设置访问令牌,再改监听地址**——没有令牌时服务器会拒绝监听非回环地址,因为内置终端等于宿主机上的一个 shell。

- 令牌只存 sha256 哈希;登录后浏览器持有的是签名过期的 HttpOnly cookie,不是令牌本身。
- 忘记令牌:在服务器上删掉 `~/.cocopit/auth.json`。
- 反向代理后面部署时,把对外域名加进系统页的 `allowedOrigins`,否则写操作会被跨站保护拦下。HTTPS 下 cookie 自动带 `Secure`。

## 一段话讲清安全模型

浏览器永远看不到凭据:OAuth 令牌在服务端进程内从 macOS 钥匙串(Linux/Windows 为 `<配置目录>/.credentials.json`)读出,用于单次上游额度查询,不落盘、不进日志、不返回。终端命令一律服务端构造——浏览器只发会话或项目 ID,从不发命令串。所有写请求过 Origin 门,WebSocket 升级另有一道。配置写入要过白名单、写前备份和 CAS 戳,并发编辑会明确失败而不是静默覆盖。

## 常见问题

- **端口被占**——改 `~/.cocopit/config.json` 里的 `port`,或删掉该文件恢复默认 7433。
- **统计数字不对劲**——删掉 `~/.cocopit/index.db` 重启;索引是纯派生数据,会从你的记录完整重建。
- **额度显示"令牌已过期"**——在终端里随便跑一次 `claude`,Claude Code 会自己刷新令牌。

## 许可

MIT
