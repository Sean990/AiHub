import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.js";
import { upsertModelAlias, upsertModelRoute, writeStoreConfig } from "../src/store.js";

async function withServer(configPath, fn) {
  const server = await createServer({ configPath });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("admin platform keys and alias model list work over HTTP", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aihub-server-admin-"));
  const configPath = path.join(dir, "config.json");
  await writeStoreConfig({
    subscriptions: [
      { name: "main", provider: "gemini", apiKey: "secret", model: "gemini-default", priority: 1 }
    ]
  }, configPath);
  await upsertModelAlias({ alias: "gpt-public", enabled: true }, configPath);
  await upsertModelRoute({
    alias: "gpt-public",
    subscriptionName: "main",
    providerModel: "gemini-route",
    priority: 1
  }, configPath);

  await withServer(configPath, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/v1/admin/platform-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "client" })
    }).then((response) => response.json());
    assert.match(created.key, /^aih_/);

    const unauthorized = await fetch(`${baseUrl}/v1/models`);
    assert.equal(unauthorized.status, 401);

    const models = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${created.key}` }
    }).then((response) => response.json());
    assert.deepEqual(models.data.map((model) => model.id), ["gpt-public"]);

    const keys = await fetch(`${baseUrl}/v1/admin/platform-keys`).then((response) => response.json());
    assert.equal(keys.data[0].name, "client");
  });
});
