/**
 * Generates a fully fake Claude Code data directory plus an isolated cocopit
 * home, so screenshots and demos never touch real data. Everything lands
 * under /tmp; the real ~/.claude and ~/.cocopit are not read or written.
 *
 *   bun scripts/demo.ts                  # writes the demo dirs, prints how to run
 *   COCOPIT_HOME=/tmp/cocopit-demo-home bun bin/cocopit.ts --port 7897
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEMO_CLAUDE = "/tmp/cocopit-demo-claude";
const DEMO_HOME = "/tmp/cocopit-demo-home";

// deterministic pseudo-random: same demo every run
let seed = 20260812;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo));

let uuidCounter = 0;
const uuid = () => `demo-${(++uuidCounter).toString(16).padStart(8, "0")}`;

interface Project {
  cwd: string;
  branch: string;
  prompts: string[];
}

const PROJECTS: Project[] = [
  {
    cwd: "/Users/demo/shop-web",
    branch: "main",
    prompts: [
      "Add a shopping cart badge that updates without a page reload",
      "The checkout form drops the coupon field on mobile — fix the layout",
      "Write integration tests for the payment webhook handler",
      "为什么购物车页面在 Safari 上白屏?帮我排查一下",
      "Refactor the product gallery to lazy-load images",
    ],
  },
  {
    cwd: "/Users/demo/api-server",
    branch: "feat/rate-limit",
    prompts: [
      "Implement per-key rate limiting with a sliding window",
      "给 /orders 接口加游标分页,兼容旧的 offset 参数",
      "Profile the N+1 queries on the orders endpoint and fix them",
      "Add OpenTelemetry tracing to the request pipeline",
    ],
  },
  {
    cwd: "/Users/demo/data-pipeline",
    branch: "main",
    prompts: [
      "The nightly ETL job silently skips malformed rows — make it report them",
      "把清洗规则抽成配置文件,支持热加载",
      "Backfill the missing partitions from the raw bucket",
    ],
  },
  {
    cwd: "/Users/demo/blog",
    branch: "main",
    prompts: [
      "Convert the blog to static generation with incremental rebuilds",
      "写一篇关于我们如何优化冷启动时间的技术博客草稿",
      "Add RSS and sitemap generation",
    ],
  },
  {
    cwd: "/Users/demo/mobile-app",
    branch: "release/2.4",
    prompts: [
      "The onboarding carousel stutters on older Android devices",
      "Add biometric login behind a feature flag",
      "崩溃日志显示 JSON 解析错误,帮我定位是哪个接口的响应变了",
    ],
  },
];

const REPLIES = [
  "I traced the issue to the event handler being re-registered on every render. Moving the registration into a `useEffect` with an empty dependency list fixes the duplication.\n\n```tsx\nuseEffect(() => {\n  const handler = () => setCount((n) => n + 1);\n  bus.on(\"cart:add\", handler);\n  return () => bus.off(\"cart:add\", handler);\n}, []);\n```\n\nAll 42 existing tests still pass.",
  "问题出在缓存键漏掉了语言参数,两个语言版本互相覆盖。修复后我加了一个回归测试覆盖这个场景:\n\n| 场景 | 修复前 | 修复后 |\n| --- | --- | --- |\n| zh → en 切换 | 命中错误缓存 | 正确 |\n| 并发首次访问 | 竞态 | 单飞(single-flight) |\n\n两个用例都通过了。",
  "Done. The migration adds a partial index on `(status, created_at)` for pending orders only — the table scan on the dashboard query drops from 1.2 s to 8 ms:\n\n```sql\nCREATE INDEX CONCURRENTLY idx_orders_pending\n  ON orders (created_at)\n  WHERE status = 'pending';\n```",
  "重构完成。核心改动是把重试逻辑从各个调用点收拢到一个装饰器里,共删除了 217 行重复代码;所有 31 个相关测试全部通过。",
  "The flaky test was racing the debounced save. I replaced the fixed `sleep(100)` with a deterministic wait on the save promise itself, and ran the suite 50 times without a failure.",
];

const MODELS = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"];

function dirNameOf(cwd: string): string {
  return cwd.replaceAll("/", "-");
}

rmSync(DEMO_CLAUDE, { recursive: true, force: true });
rmSync(DEMO_HOME, { recursive: true, force: true });
mkdirSync(DEMO_HOME, { recursive: true, mode: 0o700 });

const NOW = Date.now();
const DAY = 86_400_000;
const history: string[] = [];

for (const project of PROJECTS) {
  const projectDir = join(DEMO_CLAUDE, "projects", dirNameOf(project.cwd));
  mkdirSync(projectDir, { recursive: true });

  const sessionCount = between(9, 18);
  for (let s = 0; s < sessionCount; s++) {
    const sessionId = uuid();
    // working-hours weighted so the heatmap looks lived-in
    const daysAgo = between(0, 75);
    const hour = pick([9, 10, 10, 11, 14, 15, 15, 16, 17, 20, 22]);
    let ts = NOW - daysAgo * DAY - (NOW % DAY) + hour * 3_600_000 + between(0, 3_500_000);
    const lines: string[] = [];
    let parent: string | null = null;

    const turns = between(3, 10);
    for (let turn = 0; turn < turns; turn++) {
      const prompt = pick(project.prompts);
      const userId = uuid();
      lines.push(
        JSON.stringify({
          uuid: userId,
          parentUuid: parent,
          sessionId,
          timestamp: new Date(ts).toISOString(),
          cwd: project.cwd,
          gitBranch: project.branch,
          version: "2.1.228",
          type: "user",
          message: { role: "user", content: prompt },
        }),
      );
      history.push(
        JSON.stringify({ display: prompt, timestamp: ts, project: project.cwd, sessionId }),
      );
      ts += between(20_000, 120_000);

      const assistantId = uuid();
      const contextTokens = between(20_000, 160_000);
      lines.push(
        JSON.stringify({
          uuid: assistantId,
          parentUuid: userId,
          sessionId,
          timestamp: new Date(ts).toISOString(),
          type: "assistant",
          message: {
            model: pick(MODELS),
            role: "assistant",
            content: [{ type: "text", text: pick(REPLIES) }],
            usage: {
              input_tokens: between(200, 2_000),
              output_tokens: between(300, 4_000),
              cache_read_input_tokens: contextTokens,
              cache_creation: {
                ephemeral_5m_input_tokens: between(500, 8_000),
                ephemeral_1h_input_tokens: between(0, 12_000),
              },
            },
          },
        }),
      );
      parent = assistantId;
      ts += between(60_000, 600_000);
    }
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
  }
}

writeFileSync(join(DEMO_CLAUDE, "history.jsonl"), history.join("\n") + "\n");

// account shown on the Accounts page — entirely fictional
writeFileSync(
  join(DEMO_CLAUDE, ".claude.json"),
  JSON.stringify(
    {
      oauthAccount: {
        emailAddress: "coco@example.com",
        organizationName: "Cocoa Farm Co.",
        organizationType: "claude_max_5x",
        billingType: "stripe_subscription",
        subscriptionCreatedAt: "2026-03-14T08:00:00.000Z",
        hasExtraUsageEnabled: false,
      },
    },
    null,
    2,
  ),
);

// expired fake credentials: the quota code short-circuits to "token expired"
// without ever calling the network or the real keychain
writeFileSync(
  join(DEMO_CLAUDE, ".credentials.json"),
  JSON.stringify({ claudeAiOauth: { accessToken: "demo-not-a-real-token", expiresAt: 1 } }),
  { mode: 0o600 },
);

// the default profile points at the demo dir, so nothing resolves to ~/.claude
writeFileSync(
  join(DEMO_HOME, "profiles.json"),
  JSON.stringify(
    { profiles: [{ id: "default", name: "默认账号", kind: "subscription", configDir: DEMO_CLAUDE }] },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
writeFileSync(
  join(DEMO_HOME, "config.json"),
  JSON.stringify({ port: 7897, host: "127.0.0.1", claudeDir: DEMO_CLAUDE, allowedOrigins: [] }, null, 2) + "\n",
);

console.log(`demo data written:
  ${DEMO_CLAUDE}  (fake Claude Code data)
  ${DEMO_HOME}  (isolated cocopit home)

run the demo instance:
  COCOPIT_HOME=${DEMO_HOME} bun bin/cocopit.ts

clean up:
  rm -rf ${DEMO_CLAUDE} ${DEMO_HOME}`);
