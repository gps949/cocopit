# cocopit

Claude Code 的本地图形化控制台：用量费用统计、会话历史阅读、多账户切换、配置与权限管理、内置 Web 终端。

只依赖 [Bun](https://bun.sh)，没有其他运行时依赖。

## 启动

```bash
bun install          # 首次
bun run build        # 构建前端（改了前端代码才需要重跑）
bun run start        # 启动，打开 http://127.0.0.1:7433
```

首次启动会全量扫描 `~/.claude/projects` 建索引（本机 5.2GB / 6603 个文件约 40 秒），
之后每次启动只增量扫描变化的文件，通常 1 秒内完成。扫描进度在页面右上角实时显示，
不用等它扫完也能开始用。

开发时用 `bun run dev`：后端 watch 模式 + Vite 热更新，前端访问 http://127.0.0.1:5173 。
两者都是前台进程，`Ctrl-C` 一次同时停掉。

```bash
bun test             # 运行测试（229 个）
```

## 数据在哪

| 路径 | 内容 | 读写 |
| --- | --- | --- |
| `~/.claude/` | Claude Code 自己的数据：会话记录、配置、插件 | cocopit **只读**，仅「设置」页显式保存时写 `settings.json` |
| `~/.claude.json` | Claude Code 主配置 | **永不写入**，只读取展示 |
| `~/.cocopit/index.db` | cocopit 的索引（SQLite） | 可随时删除，重启后会重建 |
| `~/.cocopit/config.json` | cocopit 自身设置（端口、扫描目录等） | 由「系统」页写入 |
| `~/.cocopit/auth.json` | 访问令牌的哈希 | 由「系统」页写入 |

索引是纯派生数据。任何时候觉得统计不对，删掉 `index.db` 重启即可重建，不会碰你的原始记录。

## 远程访问

默认只监听 `127.0.0.1`，别的机器连不上。要从别的机器访问（比如 cocopit 跑在服务器上），
**先在「系统」页设置访问令牌，再把监听地址改成 `0.0.0.0`**。没有令牌时服务器会拒绝
监听非回环地址并告诉你原因——因为内置终端等于一个远程 shell，不设令牌就等于把这台机器
的 shell 开放给整个局域网。

令牌只存 sha256 哈希；登录后换成签名过期的 HttpOnly cookie，浏览器不持有原始令牌。
忘记令牌时，在服务器上删掉 `~/.cocopit/auth.json` 即可恢复无认证状态。

放在反向代理后面时，把你的对外域名加进「系统」页的 `allowedOrigins`，否则写操作会被
跨站保护拦掉。走 HTTPS 时 cookie 会自动带上 `Secure`。

## 端口被占用

`~/.cocopit/config.json` 里改 `port`，或者删掉这个文件恢复默认 7433。
