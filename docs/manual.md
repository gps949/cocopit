# cocopit user manual

[中文版](manual.zh-CN.md)

cocopit reads the files Claude Code already writes (`~/.claude/`) and turns them into a browsable, searchable console. This manual walks through each page, then covers remote deployment and recovery.

## Dashboard

The landing page. Everything respects the range picker (7d / 30d / 90d / All) and is bucketed in **your browser's timezone**.

- **Quota strip** — 5-hour and weekly window utilization per logged-in subscription account, with reset times. Same source as `/usage` inside Claude Code, refreshed about every 3 minutes.
- **Stat cards** — API-equivalent cost (what this usage would have cost at pay-per-token API prices — a *reference number*, not what your subscription charges you), output/input tokens, cache reads, cache savings.
  - *Hit rate* counts cache writes as misses — a written token was processed fresh at a premium, so pretending it doesn't exist would flatter the number.
  - *Cache savings* is net: read discounts minus the 1.25×/2× write premium.
- **Daily cost, By model, Top projects, By account, Activity heatmap** — where the money and the hours go.
- **Price calibration** — compares your pricing table against the `costUSD` figures Claude Code itself recorded, and flags rows that fall outside the plausible range. Unpriced models (third-party endpoints, usually) are listed in a banner; add prices on the Config page if you want them counted.

## Accounts

One card per profile. Two kinds:

- **Subscription** — a real `claude /login` account. Each non-default profile gets its own `CLAUDE_CONFIG_DIR` under `~/.claude-profiles/<id>`, so logins never collide. Create the profile, copy the login command it gives you, run it in your own terminal; the card detects the login within seconds.
- **API** — a key against the official API or any compatible endpoint (base URL, model overrides, key). No login flow.

Cards show the login email, plan, subscription dates, organization — and for subscription accounts, live **quota bars**. The OAuth token behind the quota query is read server-side (macOS Keychain, or `<config-dir>/.credentials.json` on Linux/Windows), used for one HTTPS call, and never sent to the browser. If it shows *token expired*, run any `claude` command once — Claude Code refreshes its own token.

“Set as shell default” writes `~/.cocopit/current-profile.sh` for you to source from your shell rc; it only affects new terminals and never affects how cocopit itself resumes sessions.

Deleting a profile removes the registry entry only; the login data directory stays on disk.

## Projects

Every directory Claude Code has run in. Start a new session in an existing project, or in a brand-new directory (“Start in a new directory” — the directory is created if needed and becomes a project as soon as the session writes its first record). Both paths let you pick the account and a settings preset; presets are applied with `--settings`, overlaying the session without touching any `settings.json`.

## Sessions

- **Search** — trigram full-text search across every transcript, CJK included, minimum 3 characters. Filter by project (arrive via a project row) or by account.
- **Detail view** — opens at the newest window, like a chat client; “Load earlier” pages upward without losing your place. The outline sidebar lists real user turns only (tool results and hook noise that arrive dressed as `user` records are excluded). *Search in session* finds text within this transcript and jumps to the hit.
- **Filters** — “Conversation only” hides everything but the actual exchange; thinking blocks and metadata are collapsed by default; sessions that were rewound get a “Show rewound (N)” toggle — rewound branches display with a red edge instead of silently blending into history.
- **Subagents** — click any subagent to read its own transcript; the six most expensive show by default when a session spawned dozens.
- **Related sessions** — when two files share the same conversation records (a resume/fork continued elsewhere), each links to the other, with direction when the data supports it (“continues from…”).
- **Resume in terminal** — reopens the session in a server-side tmux terminal, optionally under a different account (the transcript is copied into that account's config dir under a new session id — Claude Code only looks for sessions in its own directory).

## History

Every prompt you ever typed into Claude Code (from `history.jsonl`), searchable, newest first, each entry linking to its session when known. Useful for “I know I asked this somewhere.”

## Live & the web terminal

The Live page lists running Claude Code processes on the machine (PID-verified, not just registry entries) and every cocopit-managed tmux terminal.

Terminal facts worth knowing:

- Sessions run inside **tmux on the server**. Closing the tab, losing Wi-Fi, or locking your phone does not kill them — reopen and reattach. A *Reconnect* button appears in the terminal header when the socket drops.
- Commands are **constructed server-side**; the browser only sends session/project ids.
- On touch devices a key bar provides Esc, Tab, ^C and arrow keys (the keys the Claude Code TUI needs that virtual keyboards can't produce), plus clipboard paste.
- Typing `exit` inside the terminal ends the underlying session for real.

## Config

- **Settings editor** — user scope (`~/.claude/settings.json`) and project scope (`.claude/settings.local.json`). JSON is validated as you type; saving shows exactly which keys change. Every write is preceded by an automatic backup, and a compare-and-swap stamp means a concurrent external edit produces a clear 409 instead of a silent overwrite. A warning appears if Claude Code instances are running (they may overwrite settings on exit).
- **Presets** — save the current settings under a name; apply them back later (again: backup + diff first). Presets are independent of accounts, and new sessions can run under a preset without writing any file.
- **Permissions** — a merged view of allow/deny rules across scopes.
- **Pricing** — the per-model price table used for all cost figures. Override any price (stored separately in `~/.cocopit/pricing.user.json`; defaults stay pristine), and compare against the LiteLLM community price database with one-click adoption of differences. Changing prices triggers a full recalculation — half a million events take well under a minute.
- **MCP** — read-only view of project-scope `.mcp.json`.

## Extensions

What is extending Claude Code, grouped by account, with the *where it lives* distinction that matters when debugging “why isn't this available”: MCP servers are configured **per project** in `~/.claude.json`; plugins are installed in the config dir but enabled in `settings.json` (installed ≠ enabled — the toggle here flips the latter); skills are directories with a `SKILL.md`. MCP and skills are read-only by design.

## System

- **Index** — live scan progress, incremental rescan, full rebuild. The index is derived data; rebuilding never touches your originals.
- **Disk** — Claude Code accumulates gigabytes in debug logs and file-history snapshots. The triage groups them, cleanup always dry-runs first, and files tied to running sessions are excluded no matter what you select.
- **Backups** — every config file cocopit ever wrote, with content view, diff against the current file, and one-click restore (which itself backs up the current content first — restores are also undoable).
- **Access** — access token, listen address, allowed origins. Address changes apply live with no restart; a failed bind rolls back automatically.

## The Codex view

The sidebar switcher flips the whole console to OpenAI Codex CLI, under its own URL space (`/codex/*`) and its own visual identity (cyan over cool grays — per Codex's own TUI style guide). What carries over:

- **Dashboard / Projects / Sessions / History** — same pages, reading `~/.codex` rollouts (including `archived_sessions`). OpenAI's cached-input pricing is handled correctly; costs use the same pricing table (gpt entries included).
- **Quota, with zero credentials** — Codex writes its rate-limit windows into every transcript; cocopit shows the snapshot from each account's most recently indexed session, with an "as of" stamp. Windows are classified by their length, so the display tracks whatever OpenAI currently enforces (at the moment, weekly only).
- **Accounts** — multiple logins via isolated `CODEX_HOME` directories, the exact counterpart of `CLAUDE_CONFIG_DIR`. Login state (email, plan, subscription start) is decoded locally from `auth.json`; nothing leaves the server.
- **Multi-agent runs** — a subagent's rollout names its parent thread; children are folded out of the session list by default and reachable through the parent's related-sessions links, badged with the agent's nickname.
- **Extensions / Config** — read-only views of `config.toml` (MCP servers, plugin enablement; secret-looking values masked, env tables never surfaced) and `CODEX_HOME/skills`. Codex's native config profiles (`<name>.config.toml`, `codex --profile`) are listed — they are Codex's own counterpart of the Claude-side settings presets.
- **Terminal** — resume with `codex resume` under the owning account. Cross-account resume is not possible: Codex only finds sessions inside its own `CODEX_HOME`.

## Remote deployment

1. Set an access token (System page, only possible from localhost).
2. Change the listen address to `0.0.0.0` (or a specific interface). Without a token this is refused — the terminal is a shell on the host.
3. Behind a reverse proxy / tunnel, add the public origin to `allowedOrigins`.

The token is stored hashed; browsers hold a signed expiring cookie. To recover from a lost token, delete `~/.cocopit/auth.json` on the server.

## Recovery cheat-sheet

| Symptom | Fix |
| --- | --- |
| Stats look wrong | delete `~/.cocopit/index.db`, restart — full rebuild from transcripts |
| Lost access token | delete `~/.cocopit/auth.json` on the server |
| Port taken | edit `port` in `~/.cocopit/config.json`, or delete the file |
| Quota says token expired | run `claude` once in any terminal |
| Terminal shows disconnected | click *Reconnect* — tmux kept the session |
| Bad settings save | System → Backups → restore the pre-write backup |
