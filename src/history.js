import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getHistoryPath } from "./config.js";
import { readRequestLogs, recordRequestLog } from "./store.js";

export async function appendHistory(entry, { config, configPath } = {}) {
  if (config?.logging?.enabled === false) {
    return;
  }

  await recordRequestLog(entry, configPath);
  const historyPath = getHistoryPath(configPath);
  await mkdir(path.dirname(historyPath), { recursive: true });
  await appendFile(historyPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

export async function readHistory({ limit = 20, configPath } = {}) {
  try {
    const logs = await readRequestLogs({ limit, configPath });
    if (logs.length > 0) {
      return logs;
    }
  } catch {
    // Fall back to the legacy JSONL history file.
  }

  const historyPath = getHistoryPath(configPath);
  let raw = "";
  try {
    raw = await readFile(historyPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const lines = raw.trim().split("\n").filter(Boolean);
  return lines.slice(-Number(limit || 20)).map((line) => JSON.parse(line));
}

export function buildHistoryEntry({ request, result, error, attempts, config }) {
  const base = {
    ts: new Date().toISOString(),
    provider: result?.provider || request.provider || "auto",
    subscription: result?.subscription || request.subscription || "",
    alias: result?.alias || "",
    model: result?.model || request.model || "",
    providerModel: result?.providerModel || "",
    ok: Boolean(result),
    usage: result?.usage || {},
    platformKey: result?.platformKey,
    attempts: attempts || result?.attempts || error?.attempts || []
  };

  if (error) {
    base.error = error.message;
  }
  if (config?.logging?.includePrompt) {
    base.prompt = request.prompt;
    base.messages = request.messages;
  }
  return base;
}
