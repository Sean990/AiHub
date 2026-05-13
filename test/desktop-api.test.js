import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getManagedServiceStatus,
  fetchDesktopSubscriptionModels,
  queryDesktopSubscriptionUsage,
  readDesktopConfig,
  readDesktopUsage,
  setDesktopFallback,
  setDesktopService,
  testDesktopSubscriptionConnection,
  upsertDesktopSubscription
} from "../desktop/main/desktop-api.js";

test("desktop api reads config and returns service status without Electron", async () => {
  const previousConfig = process.env.AIHUB_CONFIG;
  const dir = await mkdtemp(path.join(os.tmpdir(), "aihub-desktop-api-"));
  process.env.AIHUB_CONFIG = path.join(dir, "config.json");

  try {
    let config = await readDesktopConfig();
    assert.equal(config.service.port, 8787);
    assert.deepEqual(config.subscriptions, []);

    config = await upsertDesktopSubscription({
      name: "desktop-test",
      provider: "gemini",
      apiKey: "secret-key",
      model: "gemini-test",
      priority: 1,
      enabled: true
    });
    assert.equal(config.subscriptions[0].name, "desktop-test");
    assert.equal(config.subscriptions[0].apiKey, "secr...-key");

    config = await upsertDesktopSubscription({
      originalName: "desktop-test",
      name: "desktop-renamed",
      provider: "gemini",
      model: "gemini-test",
      priority: 1,
      enabled: true
    });
    assert.deepEqual(config.subscriptions.map((item) => item.name), ["desktop-renamed"]);

    config = await upsertDesktopSubscription({
      name: "desktop-other",
      provider: "claude",
      apiKey: "other-key",
      model: "claude-test",
      priority: 2,
      enabled: true
    });
    await assert.rejects(
      upsertDesktopSubscription({
        originalName: "desktop-renamed",
        name: "desktop-other",
        provider: "gemini",
        model: "gemini-test",
        priority: 1,
        enabled: true
      }),
      /already exists/
    );

    config = await setDesktopFallback(false);
    assert.equal(config.routing.fallback, false);

    config = await setDesktopService({ host: "127.0.0.1", port: 9898 });
    assert.equal(config.service.port, 9898);

    const usage = await readDesktopUsage();
    assert.equal(usage.total.requests, 0);
    assert.equal(usage.subscriptions[0].name, "desktop-renamed");

    const status = await getManagedServiceStatus();
    assert.equal(status.running, false);
    assert.equal(status.baseUrl, "http://127.0.0.1:9898/v1");
  } finally {
    if (previousConfig == null) {
      delete process.env.AIHUB_CONFIG;
    } else {
      process.env.AIHUB_CONFIG = previousConfig;
    }
  }
});

test("desktop subscription model discovery can use unsaved url and api key", async () => {
  const previousConfig = process.env.AIHUB_CONFIG;
  const dir = await mkdtemp(path.join(os.tmpdir(), "aihub-desktop-models-"));
  process.env.AIHUB_CONFIG = path.join(dir, "config.json");
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/v1/usage") {
      res.end(JSON.stringify({ total: 100, used: 20, remaining: 80 }));
      return;
    }
    res.end(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const result = await fetchDesktopSubscriptionModels({
      name: "unsaved",
      provider: "openai-compatible",
      apiKey: "secret",
      baseUrl
    });
    assert.deepEqual(result.models, ["model-a", "model-b"]);

    const connection = await testDesktopSubscriptionConnection({
      name: "unsaved",
      provider: "openai-compatible",
      apiKey: "secret",
      baseUrl
    });
    assert.equal(connection.ok, true);
    assert.equal(connection.modelCount, 2);
    const usage = await queryDesktopSubscriptionUsage({
      name: "unsaved",
      provider: "openai-compatible",
      apiKey: "secret",
      baseUrl,
      usageUrl: `${baseUrl}/v1/usage`
    });
    assert.equal(usage.remaining, 80);
    assert.equal(usage.total, 100);
    assert.equal(requests[0].url, "/v1/models");
    assert.equal(requests[0].authorization, "Bearer secret");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousConfig == null) {
      delete process.env.AIHUB_CONFIG;
    } else {
      process.env.AIHUB_CONFIG = previousConfig;
    }
  }
});
