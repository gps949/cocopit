-- Where a Codex session was driven from: session_meta's originator names the
-- surface (codex_cli_rs, Codex Desktop, codex_chatgpt_ios_remote, codex_sdk_ts,
-- …). One machine's rollouts mix CLI work, Desktop imports, and ChatGPT-driven
-- remote tasks — telling them apart is how a "why is this session weird"
-- question gets answered.
ALTER TABLE sessions ADD COLUMN origin TEXT;
