const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Where to bind the listener. Anything past loopback puts the built-in
 * terminal — an interactive shell on this machine — on the network, so a
 * non-loopback bind is refused until an access token exists. The two settings
 * are only useful together; treating them as independent knobs is what turns a
 * console into an open shell.
 */
export function resolveBindHost(configured: string | undefined, tokenConfigured: boolean): string {
  const host = configured?.trim() || "127.0.0.1";
  if (LOOPBACK.has(host) || tokenConfigured) return host;

  throw new Error(
    `拒绝监听 ${host}：未设置访问令牌。\n` +
      `ccockpit 内置终端等同于本机 shell，开放到回环地址之外而不加认证，` +
      `等于把这台机器的 shell 交给所有能连上该地址的人。\n` +
      `请先在「系统」页设置访问令牌，或把 ~/.ccockpit/config.json 的 host 改回 127.0.0.1。`,
  );
}
