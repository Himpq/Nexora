import test from "node:test";
import assert from "node:assert/strict";

import { login } from "../sessionService";

type FetchCall = { url: string; init: RequestInit };

function installFetch(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
  }) as typeof fetch;
  return calls;
}

test("login posts trimmed credentials to /login", async () => {
  const calls = installFetch({ success: true, role: "member" });
  const result = await login("  Mujica  ", "secret");
  assert.equal(calls[0].url, "https://chat.himpqblog.cn/login");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    username: "Mujica",
    password: "secret",
  });
  assert.equal(result.success, true);
});

test("login throws on rejected credentials", async () => {
  installFetch({ success: false, message: "密码错误" });
  await assert.rejects(() => login("mujica", "wrong"), /密码错误/);
});
