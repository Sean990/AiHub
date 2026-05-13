import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeConfig,
  readConfig,
  redactSecret,
  removeSubscription,
  setSubscriptionPriority,
  upsertSubscription
} from "../src/config.js";
import { selectSubscriptions } from "../src/router.js";

test("subscriptions are sorted by enabled state and priority", () => {
  const config = normalizeConfig({
    subscriptions: [
      { name: "slow", provider: "claude", apiKey: "a", model: "m", priority: 20 },
      { name: "fast", provider: "gemini", apiKey: "b", model: "m", priority: 1 },
      { name: "off", provider: "openai-compatible", apiKey: "c", model: "m", priority: 0, enabled: false }
    ]
  });

  assert.deepEqual(
    config.subscriptions.map((subscription) => subscription.name),
    ["fast", "slow", "off"]
  );
});

test("selectSubscriptions filters provider and explicit subscription", () => {
  const config = normalizeConfig({
    subscriptions: [
      { name: "g1", provider: "gemini", apiKey: "a", model: "m", priority: 2 },
      { name: "g2", provider: "gemini", apiKey: "b", model: "m", priority: 1 },
      { name: "c1", provider: "claude", apiKey: "c", model: "m", priority: 0 }
    ]
  });

  assert.deepEqual(
    selectSubscriptions(config, { provider: "gemini" }).map((subscription) => subscription.name),
    ["g2", "g1"]
  );
  assert.deepEqual(
    selectSubscriptions(config, { subscription: "c1" }).map((subscription) => subscription.name),
    ["c1"]
  );
});

test("selectSubscriptions narrows by declared subscription models", () => {
  const config = normalizeConfig({
    subscriptions: [
      { name: "g1", provider: "gemini", apiKey: "a", model: "gemini-a", models: ["gemini-a", "gemini-b"], priority: 2 },
      { name: "c1", provider: "claude", apiKey: "c", model: "claude-a", models: ["claude-a"], priority: 1 }
    ]
  });

  assert.deepEqual(
    selectSubscriptions(config, { model: "gemini-b" }).map((subscription) => subscription.name),
    ["g1"]
  );
  assert.deepEqual(
    selectSubscriptions(config, { model: "unknown" }).map((subscription) => subscription.name),
    ["c1", "g1"]
  );
});

test("normalizeSubscription keeps a primary model and multiple supported models", () => {
  const config = normalizeConfig({
    subscriptions: [
      { name: "multi", provider: "codex", apiKey: "a", models: ["gpt-b", "gpt-a"] }
    ]
  });

  assert.equal(config.subscriptions[0].model, "gpt-b");
  assert.deepEqual(config.subscriptions[0].models, ["gpt-b", "gpt-a"]);
});

test("upsert, priority, and remove mutate subscriptions predictably", () => {
  const config = normalizeConfig({ subscriptions: [] });
  upsertSubscription(config, { name: "main", provider: "openai-compatible", apiKey: "secret", model: "m" });
  setSubscriptionPriority(config, "main", 3);

  assert.equal(config.subscriptions[0].priority, 3);
  removeSubscription(config, "main");
  assert.equal(config.subscriptions.length, 0);
});

test("redactSecret keeps only a small recognizable edge", () => {
  assert.equal(redactSecret("sk-1234567890"), "sk-1...7890");
  assert.equal(redactSecret("short"), "********");
});

test("readConfig treats an empty config file as default config", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aihub-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, "");

  const config = await readConfig(configPath);
  assert.equal(config.service.port, 8787);
  assert.deepEqual(config.subscriptions, []);
});
