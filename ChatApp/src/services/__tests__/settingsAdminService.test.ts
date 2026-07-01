import test from "node:test";
import assert from "node:assert/strict";

import {
  getRoughReadingModelSettings,
  getSettingsLogs,
  getSettingsModels,
  listSettingsUsers,
  patchRoughReadingModelSettings,
  patchSettingsModels,
  updateSettingsUser,
} from "../settingsAdminService";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function installFetch(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return jsonResponse(payload, status);
  }) as typeof fetch;
  return calls;
}

test("settings admin service reads users, models and logs", async () => {
  const calls = installFetch({ success: true, items: [], total: 0 });

  await listSettingsUsers({ q: "ada", limit: 5 });
  await getSettingsModels();
  await getRoughReadingModelSettings();
  await getSettingsLogs({ limit: 10, level: "warn" });

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/users?q=ada&limit=5",
  );
  assert.equal(calls[1].url, "https://chat.himpqblog.cn:5002/api/frontend/settings/models");
  assert.equal(calls[2].url, "https://chat.himpqblog.cn:5002/api/models/rough-reading");
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/logs?limit=10&level=warn",
  );
});

test("settings admin service updates users and models", async () => {
  const calls = installFetch({ success: true, user: { user_id: "u1" }, settings: {} });

  await updateSettingsUser("user 1", { identity: "teacher" });
  await patchSettingsModels({ default_nexora_model: "model-1" });
  await patchRoughReadingModelSettings({ enabled: true });

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/users/user%201",
  );
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { identity: "teacher" });
  assert.equal(calls[1].url, "https://chat.himpqblog.cn:5002/api/frontend/settings/models");
  assert.equal(calls[2].url, "https://chat.himpqblog.cn:5002/api/models/rough-reading");
});
