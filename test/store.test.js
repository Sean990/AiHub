import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { selectSubscriptions } from "../src/router.js";
import {
  authenticatePlatformKey,
  createPlatformKey,
  migrationStatus,
  readStoreConfig,
  recordRequestLog,
  upsertModelAlias,
  upsertModelRoute,
  writeStoreConfig
} from "../src/store.js";

async function tempConfigPath(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(dir, "config.json");
}

test("store migrates legacy JSON config once into SQLite", async () => {
  const configPath = await tempConfigPath("aihub-store-migrate-");
  await writeFile(configPath, JSON.stringify({
    service: { host: "127.0.0.1", port: 9999 },
    routing: { fallback: false },
    logging: { enabled: true, includePrompt: false },
    subscriptions: [
      { name: "legacy", provider: "gemini", apiKey: "secret", model: "gemini-test", priority: 3 }
    ]
  }));

  const config = await readStoreConfig(configPath);
  assert.equal(config.service.port, 9999);
  assert.equal(config.routing.fallback, false);
  assert.equal(config.subscriptions[0].name, "legacy");

  const status = await migrationStatus(configPath);
  assert.equal(status.jsonMigrated, true);
  assert.equal(status.subscriptions, 1);
});

test("platform keys enforce auth and monthly request quota", async () => {
  const configPath = await tempConfigPath("aihub-store-key-");
  const compatible = await authenticatePlatformKey("Bearer aihub-local", configPath);
  assert.equal(compatible.compatibility, true);

  const created = await createPlatformKey({
    name: "quota-key",
    monthlyRequestQuota: 1,
    monthlyTokenQuota: 0
  }, configPath);

  await assert.rejects(
    () => authenticatePlatformKey("Bearer wrong", configPath),
    /Invalid or disabled platform key/
  );

  const authed = await authenticatePlatformKey(`Bearer ${created.key}`, configPath);
  assert.equal(authed.name, "quota-key");

  await recordRequestLog({
    ts: new Date().toISOString(),
    ok: true,
    platformKey: authed,
    subscription: "main",
    provider: "gemini",
    model: "m",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 4 },
    attempts: [{ ok: true, latencyMs: 12 }]
  }, configPath);

  await assert.rejects(
    () => authenticatePlatformKey(`Bearer ${created.key}`, configPath),
    /monthly request quota exceeded/
  );
});

test("model aliases route to provider models by route priority", async () => {
  const configPath = await tempConfigPath("aihub-store-model-");
  await writeStoreConfig({
    subscriptions: [
      { name: "slow", provider: "claude", apiKey: "a", model: "claude-default", models: ["claude-default", "claude-route"], priority: 20 },
      { name: "fast", provider: "gemini", apiKey: "b", model: "gemini-default", models: ["gemini-default", "gemini-route"], priority: 1 }
    ]
  }, configPath);
  await upsertModelAlias({ alias: "gpt-public", description: "public", enabled: true }, configPath);
  await upsertModelRoute({
    alias: "gpt-public",
    subscriptionName: "slow",
    providerModel: "claude-route",
    priority: 20
  }, configPath);
  await upsertModelRoute({
    alias: "gpt-public",
    subscriptionName: "fast",
    providerModel: "gemini-route",
    priority: 1
  }, configPath);

  const config = await readStoreConfig(configPath);
  const selected = selectSubscriptions(config, { model: "gpt-public" });
  assert.deepEqual(selected.map((subscription) => subscription.name), ["fast", "slow"]);
  assert.equal(selected[0].alias, "gpt-public");
  assert.equal(selected[0].model, "gemini-route");

  const reloaded = await readStoreConfig(configPath);
  assert.deepEqual(reloaded.subscriptions.find((item) => item.name === "fast").models, ["gemini-default", "gemini-route"]);
});
