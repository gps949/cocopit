#!/usr/bin/env bun
// Runs the server (watch mode) and the vite dev server in parallel.
// Forwards SIGINT/SIGTERM to both children; if either child exits, the other
// is killed and this process exits with the first child's exit code.

const server = Bun.spawn(["bun", "--watch", "server/index.ts"], {
  cwd: import.meta.dir + "/..",
  stdout: "inherit",
  stderr: "inherit",
});

const web = Bun.spawn(["bunx", "vite"], {
  cwd: import.meta.dir + "/../web",
  stdout: "inherit",
  stderr: "inherit",
});

function forwardSignal(signal: "SIGINT" | "SIGTERM") {
  process.on(signal, () => {
    server.kill(signal);
    web.kill(signal);
  });
}

forwardSignal("SIGINT");
forwardSignal("SIGTERM");

const first = await Promise.race([
  server.exited.then((code) => ({ who: "server" as const, code })),
  web.exited.then((code) => ({ who: "web" as const, code })),
]);

if (first.who === "server") {
  web.kill();
} else {
  server.kill();
}

process.exit(first.code);
