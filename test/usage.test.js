import assert from "node:assert/strict";
import test from "node:test";
import { buildUsageStats } from "../src/usage.js";

test("buildUsageStats aggregates total and per-subscription cache hit rate", () => {
  const stats = buildUsageStats(
    [
      {
        ts: "2026-05-13T00:00:00.000Z",
        ok: true,
        provider: "gemini",
        subscription: "g1",
        model: "m1",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 25 },
        attempts: [{ ok: true, latencyMs: 50 }]
      },
      {
        ts: "2026-05-13T00:01:00.000Z",
        ok: false,
        provider: "gemini",
        subscription: "g1",
        model: "m1",
        usage: {},
        attempts: [{ ok: false }]
      },
      {
        ts: "2026-05-13T00:02:00.000Z",
        ok: true,
        provider: "claude",
        subscription: "c1",
        model: "m2",
        usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60, cachedInputTokens: 25 },
        attempts: [{ ok: true, latencyMs: 100 }]
      }
    ],
    {
      subscriptions: [
        { name: "g1", provider: "gemini", model: "m1", priority: 1, enabled: true },
        { name: "c1", provider: "claude", model: "m2", priority: 2, enabled: true }
      ]
    }
  );

  assert.equal(stats.total.requests, 3);
  assert.equal(stats.total.successes, 2);
  assert.equal(stats.total.totalTokens, 180);
  assert.equal(stats.total.cachedInputTokens, 50);
  assert.equal(stats.total.cacheHitRate, 50 / 150);
  assert.equal(stats.subscriptions[0].name, "g1");
  assert.equal(stats.subscriptions[0].requests, 2);
  assert.equal(stats.subscriptions[0].successRate, 0.5);
  assert.equal(stats.subscriptions[1].cacheHitRate, 0.5);
});
