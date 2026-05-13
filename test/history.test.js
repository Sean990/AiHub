import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendHistory, buildHistoryEntry, readHistory } from "../src/history.js";

test("history writes compact request metadata without prompt by default", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aihub-history-"));
  const configPath = path.join(dir, "config.json");
  const config = {
    logging: {
      enabled: true,
      includePrompt: false
    }
  };

  const entry = buildHistoryEntry({
    request: { prompt: "secret prompt", provider: "auto" },
    result: {
      provider: "gemini",
      subscription: "main",
      model: "model",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 5 },
      attempts: [{ ok: true }]
    },
    config
  });
  await appendHistory(entry, { config, configPath });

  const entries = await readHistory({ configPath });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ok, true);
  assert.equal(entries[0].prompt, undefined);
  assert.equal(entries[0].subscription, "main");
  assert.equal(entries[0].usage.totalTokens, 14);
});
