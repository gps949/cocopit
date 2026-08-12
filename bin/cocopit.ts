#!/usr/bin/env bun
import { runServer } from "../server/index";
import pkg from "../package.json" with { type: "json" };

const HELP = `cocopit ${pkg.version} — a local-first web console for Claude Code

Usage: cocopit [options]

Options:
  -p, --port <n>    port to listen on (default: 7433, or COCOPIT_PORT,
                    or "port" in ~/.cocopit/config.json)
  -H, --host <addr> address to bind (default: 127.0.0.1; anything beyond
                    loopback requires an access token — set it on the
                    System page first)
  -v, --version     print the version
  -h, --help        show this help

Runs in the foreground. To keep it running in the background:
  nohup cocopit > ~/.cocopit/cocopit.log 2>&1 &
  # or under tmux:  tmux new -d -s cocopit cocopit
`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let port: number | undefined;
let host: string | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  switch (arg) {
    case "-h":
    case "--help":
      console.log(HELP);
      process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case "-v":
    case "--version":
      console.log(pkg.version);
      process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case "-p":
    case "--port": {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        fail(`invalid port: ${args[i] ?? "(missing)"}`);
      }
      port = value;
      break;
    }
    case "-H":
    case "--host": {
      const value = args[++i];
      if (!value) fail("--host needs an address");
      host = value;
      break;
    }
    default:
      fail(`unknown option: ${arg}\n\n${HELP}`);
  }
}

runServer({ port, host });
