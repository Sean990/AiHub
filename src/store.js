import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  compareSubscriptions,
  defaultConfig,
  getConfigPath,
  getDataDir,
  normalizeConfig,
  normalizeSubscription,
  redactSubscription
} from "./config.js";
import { emptyUsage, finalizeUsageStats, addUsage } from "./usage.js";

const stores = new Map();

export function getDbPath(configPath = getConfigPath()) {
  return process.env.AIHUB_DB || path.join(getDataDir(configPath), "aihub.db");
}

export async function getStore(configPath = getConfigPath()) {
  const dbPath = getDbPath(configPath);
  if (stores.has(dbPath)) {
    return stores.get(dbPath);
  }
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  ensureSchema(db);
  await migrateJsonConfig(db, configPath);
  stores.set(dbPath, db);
  return db;
}

export async function readStoreConfig(configPath = getConfigPath()) {
  const db = await getStore(configPath);
  const settings = readSettings(db);
  const base = defaultConfig();
  const config = normalizeConfig({
    ...base,
    service: {
      host: settings.serviceHost || base.service.host,
      port: Number(settings.servicePort || base.service.port)
    },
    routing: {
      fallback: settings.routingFallback == null ? base.routing.fallback : settings.routingFallback === "true",
      requestTimeoutMs: Number(settings.requestTimeoutMs || 120000),
      retryAttempts: Number(settings.retryAttempts || 5)
    },
    logging: {
      enabled: settings.loggingEnabled == null ? base.logging.enabled : settings.loggingEnabled === "true",
      includePrompt: settings.loggingIncludePrompt == null ? base.logging.includePrompt : settings.loggingIncludePrompt === "true"
    },
    subscriptions: listStoreSubscriptions(db)
  });
  config.modelAliases = listModelAliasesFromDb(db);
  return config;
}

export async function writeStoreConfig(config, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  const normalized = normalizeConfig(config);
  transaction(db, () => {
    writeSettings(db, normalized);
    db.exec("DELETE FROM subscriptions");
    for (const subscription of normalized.subscriptions) {
      upsertSubscriptionRow(db, subscription);
    }
  });
  return readStoreConfig(configPath);
}

export async function updateStoreConfig(mutator, configPath = getConfigPath()) {
  const config = await readStoreConfig(configPath);
  const next = await mutator(config);
  return writeStoreConfig(next || config, configPath);
}

export async function migrationStatus(configPath = getConfigPath()) {
  const db = await getStore(configPath);
  return {
    dbPath: getDbPath(configPath),
    configPath,
    initialized: true,
    jsonMigrated: getSetting(db, `jsonMigrated:${configPath}`) === "true",
    subscriptions: db.prepare("SELECT COUNT(*) AS count FROM subscriptions").get().count,
    platformKeys: db.prepare("SELECT COUNT(*) AS count FROM platform_keys").get().count,
    modelAliases: db.prepare("SELECT COUNT(*) AS count FROM model_aliases").get().count
  };
}

export async function listPlatformKeys(configPath = getConfigPath()) {
  const db = await getStore(configPath);
  return db.prepare(`
    SELECT id, name, key_prefix AS keyPrefix, enabled, monthly_request_quota AS monthlyRequestQuota,
           monthly_token_quota AS monthlyTokenQuota, last_used_at AS lastUsedAt, created_at AS createdAt,
           updated_at AS updatedAt
    FROM platform_keys
    ORDER BY created_at DESC, id DESC
  `).all().map((row) => ({
    ...row,
    enabled: Boolean(row.enabled),
    ...platformKeyUsage(db, row.id)
  }));
}

export async function createPlatformKey({ name, monthlyRequestQuota = 0, monthlyTokenQuota = 0 } = {}, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  const token = `aih_${randomBytes(24).toString("base64url")}`;
  const keyHash = hashToken(token);
  const keyPrefix = `${token.slice(0, 8)}...${token.slice(-4)}`;
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO platform_keys (name, key_hash, key_prefix, enabled, monthly_request_quota, monthly_token_quota, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    name || `平台 Key ${now.slice(0, 10)}`,
    keyHash,
    keyPrefix,
    Number(monthlyRequestQuota || 0),
    Number(monthlyTokenQuota || 0),
    now,
    now
  );
  const keys = await listPlatformKeys(configPath);
  return {
    key: token,
    item: keys.find((item) => item.id === result.lastInsertRowid)
  };
}

export async function updatePlatformKey(id, patch = {}, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  const current = db.prepare("SELECT * FROM platform_keys WHERE id = ?").get(Number(id));
  if (!current) {
    throw new Error(`Platform key "${id}" was not found.`);
  }
  db.prepare(`
    UPDATE platform_keys
    SET name = ?, enabled = ?, monthly_request_quota = ?, monthly_token_quota = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name == null ? current.name : String(patch.name || current.name),
    patch.enabled == null ? current.enabled : patch.enabled ? 1 : 0,
    patch.monthlyRequestQuota == null ? current.monthly_request_quota : Number(patch.monthlyRequestQuota || 0),
    patch.monthlyTokenQuota == null ? current.monthly_token_quota : Number(patch.monthlyTokenQuota || 0),
    new Date().toISOString(),
    Number(id)
  );
  return listPlatformKeys(configPath);
}

export async function setPlatformKeyEnabled(id, enabled, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  db.prepare("UPDATE platform_keys SET enabled = ?, updated_at = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    new Date().toISOString(),
    Number(id)
  );
  return listPlatformKeys(configPath);
}

export async function deletePlatformKey(id, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  db.prepare("DELETE FROM platform_keys WHERE id = ?").run(Number(id));
  return listPlatformKeys(configPath);
}

export async function authenticatePlatformKey(authHeader, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  const count = db.prepare("SELECT COUNT(*) AS count FROM platform_keys").get().count;
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (count === 0) {
    if (token && token !== "aihub-local") {
      throw httpError(401, "Invalid platform key. Use aihub-local before creating platform keys.");
    }
    return { id: null, name: "本地兼容", keyPrefix: "aihub-local", compatibility: true };
  }
  if (!token) {
    throw httpError(401, "Missing platform key.");
  }
  const row = db.prepare(`
    SELECT id, name, key_prefix AS keyPrefix, enabled, monthly_request_quota AS monthlyRequestQuota,
           monthly_token_quota AS monthlyTokenQuota
    FROM platform_keys
    WHERE key_hash = ?
  `).get(hashToken(token));
  if (!row || !row.enabled) {
    throw httpError(401, "Invalid or disabled platform key.");
  }
  const usage = platformKeyUsage(db, row.id);
  if (row.monthlyRequestQuota > 0 && usage.monthRequests >= row.monthlyRequestQuota) {
    throw httpError(429, "Platform key monthly request quota exceeded.");
  }
  if (row.monthlyTokenQuota > 0 && usage.monthTokens >= row.monthlyTokenQuota) {
    throw httpError(429, "Platform key monthly token quota exceeded.");
  }
  db.prepare("UPDATE platform_keys SET last_used_at = ?, updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    new Date().toISOString(),
    row.id
  );
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    monthlyRequestQuota: row.monthlyRequestQuota,
    monthlyTokenQuota: row.monthlyTokenQuota
  };
}

export async function listModelAliases(configPath = getConfigPath()) {
  const db = await getStore(configPath);
  return listModelAliasesFromDb(db);
}

export async function upsertModelAlias({ alias, description = "", enabled = true } = {}, configPath = getConfigPath()) {
  if (!alias) {
    throw new Error("Model alias is required.");
  }
  const db = await getStore(configPath);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO model_aliases (alias, description, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(alias) DO UPDATE SET description = excluded.description, enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(alias, description, enabled ? 1 : 0, now, now);
  return listModelAliases(configPath);
}

export async function deleteModelAlias(alias, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  db.prepare("DELETE FROM model_aliases WHERE alias = ?").run(alias);
  return listModelAliases(configPath);
}

export async function setModelAliasEnabled(alias, enabled, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  db.prepare("UPDATE model_aliases SET enabled = ?, updated_at = ? WHERE alias = ?").run(
    enabled ? 1 : 0,
    new Date().toISOString(),
    alias
  );
  return listModelAliases(configPath);
}

export async function upsertModelRoute({ id, alias, subscriptionName, providerModel, priority = 100, enabled = true } = {}, configPath = getConfigPath()) {
  if (!alias || !subscriptionName) {
    throw new Error("Model route requires alias and subscriptionName.");
  }
  const db = await getStore(configPath);
  const now = new Date().toISOString();
  if (id) {
    db.prepare(`
      UPDATE model_routes
      SET alias = ?, subscription_name = ?, provider_model = ?, priority = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(alias, subscriptionName, providerModel || "", Number(priority), enabled ? 1 : 0, now, Number(id));
  } else {
    db.prepare(`
      INSERT INTO model_routes (alias, subscription_name, provider_model, priority, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(alias, subscriptionName, providerModel || "", Number(priority), enabled ? 1 : 0, now, now);
  }
  return listModelAliases(configPath);
}

export async function deleteModelRoute(id, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  db.prepare("DELETE FROM model_routes WHERE id = ?").run(Number(id));
  return listModelAliases(configPath);
}

export async function recordRequestLog(entry, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  const usage = entry.usage || {};
  const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
  const successful = attempts.find((attempt) => attempt.ok && Number.isFinite(Number(attempt.latencyMs)));
  db.prepare(`
    INSERT INTO request_logs (
      ts, platform_key_id, platform_key_name, model_alias, subscription, provider, model, provider_model,
      ok, status, error, usage_json, attempts_json, latency_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.ts || new Date().toISOString(),
    entry.platformKey?.id || null,
    entry.platformKey?.name || "",
    entry.alias || "",
    entry.subscription || "",
    entry.provider || "",
    entry.model || "",
    entry.providerModel || "",
    entry.ok ? 1 : 0,
    entry.ok ? "ok" : "error",
    entry.error || "",
    JSON.stringify(usage),
    JSON.stringify(attempts),
    successful ? Number(successful.latencyMs) : 0
  );
}

export async function readRequestLogs({ limit = 100, configPath = getConfigPath() } = {}) {
  const db = await getStore(configPath);
  return db.prepare(`
    SELECT * FROM request_logs
    ORDER BY ts DESC, id DESC
    LIMIT ?
  `).all(Number(limit || 100)).reverse().map(requestLogRowToEntry);
}

export async function exportStore({ includeProviderKeys = false, configPath = getConfigPath() } = {}) {
  const config = await readStoreConfig(configPath);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: {
      service: config.service,
      routing: config.routing,
      logging: config.logging
    },
    subscriptions: includeProviderKeys ? config.subscriptions : config.subscriptions.map(redactSubscription),
    platformKeys: await listPlatformKeys(configPath),
    modelAliases: await listModelAliases(configPath)
  };
}

export async function importStore(payload, configPath = getConfigPath()) {
  const db = await getStore(configPath);
  transaction(db, () => {
    if (payload.config) {
      writeSettings(db, normalizeConfig({ ...defaultConfig(), ...payload.config }));
    }
    for (const subscription of payload.subscriptions || []) {
      const normalized = normalizeSubscription({
        ...subscription,
        apiKey: String(subscription.apiKey || "").includes("...") ? "" : subscription.apiKey
      });
      const existing = db.prepare("SELECT api_key AS apiKey FROM subscriptions WHERE name = ?").get(normalized.name);
      upsertSubscriptionRow(db, {
        ...normalized,
        apiKey: normalized.apiKey || existing?.apiKey || ""
      });
    }
    for (const alias of payload.modelAliases || []) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO model_aliases (alias, description, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET description = excluded.description, enabled = excluded.enabled, updated_at = excluded.updated_at
      `).run(alias.alias, alias.description || "", alias.enabled !== false ? 1 : 0, now, now);
      db.prepare("DELETE FROM model_routes WHERE alias = ?").run(alias.alias);
      for (const route of alias.routes || []) {
        db.prepare(`
          INSERT INTO model_routes (alias, subscription_name, provider_model, priority, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(alias.alias, route.subscriptionName, route.providerModel || "", Number(route.priority || 100), route.enabled !== false ? 1 : 0, now, now);
      }
    }
    for (const key of payload.platformKeys || []) {
      const now = new Date().toISOString();
      const keyHash = key.keyHash || hashToken(`imported:${key.name}:${key.keyPrefix}:${randomBytes(8).toString("hex")}`);
      db.prepare(`
        INSERT INTO platform_keys (
          name, key_hash, key_prefix, enabled, monthly_request_quota, monthly_token_quota, last_used_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          key_prefix = excluded.key_prefix,
          enabled = excluded.enabled,
          monthly_request_quota = excluded.monthly_request_quota,
          monthly_token_quota = excluded.monthly_token_quota,
          updated_at = excluded.updated_at
      `).run(
        key.name || `导入 Key ${now.slice(0, 10)}`,
        keyHash,
        key.keyPrefix || "imported",
        key.keyHash && key.enabled !== false ? 1 : 0,
        Number(key.monthlyRequestQuota || 0),
        Number(key.monthlyTokenQuota || 0),
        key.lastUsedAt || "",
        key.createdAt || now,
        now
      );
    }
  });
  return readStoreConfig(configPath);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      name TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      models_json TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      base_url TEXT NOT NULL DEFAULT '',
      usage_url TEXT NOT NULL DEFAULT '',
      api_version TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      timeout_ms INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS platform_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      monthly_request_quota INTEGER NOT NULL DEFAULT 0,
      monthly_token_quota INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_aliases (
      alias TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias TEXT NOT NULL REFERENCES model_aliases(alias) ON DELETE CASCADE,
      subscription_name TEXT NOT NULL,
      provider_model TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      platform_key_id INTEGER,
      platform_key_name TEXT NOT NULL DEFAULT '',
      model_alias TEXT NOT NULL DEFAULT '',
      subscription TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      provider_model TEXT NOT NULL DEFAULT '',
      ok INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '{}',
      attempts_json TEXT NOT NULL DEFAULT '[]',
      latency_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_request_logs_month_key ON request_logs(platform_key_id, ts);
    CREATE INDEX IF NOT EXISTS idx_request_logs_subscription ON request_logs(subscription, ts);
  `);
  ensureColumn(db, "subscriptions", "models_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "subscriptions", "usage_url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "subscriptions", "website", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "subscriptions", "notes", "TEXT NOT NULL DEFAULT ''");
}

async function migrateJsonConfig(db, configPath) {
  const marker = `jsonMigrated:${configPath}`;
  if (getSetting(db, marker) === "true") {
    return;
  }
  let raw = "";
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const config = raw.trim() ? normalizeConfig(JSON.parse(raw)) : defaultConfig();
  transaction(db, () => {
    writeSettings(db, config);
    for (const subscription of config.subscriptions || []) {
      upsertSubscriptionRow(db, subscription);
    }
    setSetting(db, marker, "true");
  });
}

function readSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function writeSettings(db, config) {
  setSetting(db, "serviceHost", config.service.host);
  setSetting(db, "servicePort", String(config.service.port));
  setSetting(db, "routingFallback", String(config.routing.fallback !== false));
  setSetting(db, "requestTimeoutMs", String(config.routing.requestTimeoutMs || 120000));
  setSetting(db, "retryAttempts", String(config.routing.retryAttempts || 5));
  setSetting(db, "loggingEnabled", String(config.logging.enabled !== false));
  setSetting(db, "loggingIncludePrompt", String(Boolean(config.logging.includePrompt)));
}

function getSetting(db, key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function listStoreSubscriptions(db) {
  return db.prepare(`
    SELECT name, provider, api_key AS apiKey, model, models_json AS modelsJson, priority, enabled, base_url AS baseUrl,
           usage_url AS usageUrl,
           api_version AS apiVersion, website, notes, timeout_ms AS timeoutMs, tags_json AS tagsJson
    FROM subscriptions
  `).all().map((row) => normalizeSubscription({
    ...row,
    enabled: Boolean(row.enabled),
    models: JSON.parse(row.modelsJson || "[]"),
    timeoutMs: Number(row.timeoutMs || 0),
    tags: JSON.parse(row.tagsJson || "[]")
  })).sort(compareSubscriptions);
}

function upsertSubscriptionRow(db, subscription) {
  const normalized = normalizeSubscription(subscription);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO subscriptions (
      name, provider, api_key, model, models_json, priority, enabled, base_url, usage_url, api_version, website, notes, timeout_ms, tags_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      provider = excluded.provider,
      api_key = excluded.api_key,
      model = excluded.model,
      models_json = excluded.models_json,
      priority = excluded.priority,
      enabled = excluded.enabled,
      base_url = excluded.base_url,
      usage_url = excluded.usage_url,
      api_version = excluded.api_version,
      website = excluded.website,
      notes = excluded.notes,
      timeout_ms = excluded.timeout_ms,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at
  `).run(
    normalized.name,
    normalized.provider,
    normalized.apiKey,
    normalized.model,
    JSON.stringify(normalized.models || []),
    normalized.priority,
    normalized.enabled ? 1 : 0,
    normalized.baseUrl,
    normalized.usageUrl,
    normalized.apiVersion,
    normalized.website,
    normalized.notes,
    Number(subscription.timeoutMs || 0),
    JSON.stringify(normalized.tags || []),
    now,
    now
  );
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function listModelAliasesFromDb(db) {
  const aliases = db.prepare(`
    SELECT alias, description, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM model_aliases
    ORDER BY alias
  `).all().map((row) => ({ ...row, enabled: Boolean(row.enabled), routes: [] }));
  const byAlias = new Map(aliases.map((alias) => [alias.alias, alias]));
  for (const route of db.prepare(`
    SELECT id, alias, subscription_name AS subscriptionName, provider_model AS providerModel,
           priority, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM model_routes
    ORDER BY priority, id
  `).all()) {
    byAlias.get(route.alias)?.routes.push({ ...route, enabled: Boolean(route.enabled) });
  }
  return aliases;
}

function requestLogRowToEntry(row) {
  return {
    ts: row.ts,
    platformKey: row.platform_key_id ? { id: row.platform_key_id, name: row.platform_key_name } : undefined,
    alias: row.model_alias,
    subscription: row.subscription,
    provider: row.provider,
    model: row.model,
    providerModel: row.provider_model,
    ok: Boolean(row.ok),
    error: row.error || undefined,
    usage: JSON.parse(row.usage_json || "{}"),
    attempts: JSON.parse(row.attempts_json || "[]")
  };
}

function platformKeyUsage(db, id) {
  const month = new Date().toISOString().slice(0, 7);
  const row = db.prepare(`
    SELECT COUNT(*) AS monthRequests,
           COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS monthSuccesses,
           COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS monthFailures,
           COALESCE(SUM(CAST(json_extract(usage_json, '$.totalTokens') AS INTEGER)), 0) AS monthTokens,
           COALESCE(SUM(CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER)), 0) AS cachedInputTokens,
           COALESCE(SUM(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER)), 0) AS inputTokens
    FROM request_logs
    WHERE platform_key_id = ? AND substr(ts, 1, 7) = ?
  `).get(id, month);
  return {
    monthRequests: Number(row.monthRequests || 0),
    monthSuccesses: Number(row.monthSuccesses || 0),
    monthFailures: Number(row.monthFailures || 0),
    monthTokens: Number(row.monthTokens || 0),
    cachedInputTokens: Number(row.cachedInputTokens || 0),
    cacheHitRate: Number(row.inputTokens || 0) > 0 ? Number(row.cachedInputTokens || 0) / Number(row.inputTokens || 0) : 0,
    successRate: Number(row.monthRequests || 0) > 0 ? Number(row.monthSuccesses || 0) / Number(row.monthRequests || 0) : 0
  };
}

export async function buildStoreUsageStats(configPath = getConfigPath()) {
  const config = await readStoreConfig(configPath);
  const logs = await readRequestLogs({ limit: 10000, configPath });
  const total = emptyUsage();
  const rows = new Map();
  for (const subscription of config.subscriptions || []) {
    rows.set(subscription.name, {
      ...emptyUsage(),
      name: subscription.name,
      provider: subscription.provider,
      model: subscription.model,
      priority: subscription.priority,
      enabled: subscription.enabled,
      lastUsedAt: ""
    });
  }
  for (const log of logs) {
    const row = rows.get(log.subscription) || {
      ...emptyUsage(),
      name: log.subscription || "unknown",
      provider: log.provider,
      model: log.model,
      priority: 9999,
      enabled: false,
      lastUsedAt: ""
    };
    rows.set(row.name, row);
    total.requests += 1;
    row.requests += 1;
    if (log.ok) {
      total.successes += 1;
      row.successes += 1;
    } else {
      total.failures += 1;
      row.failures += 1;
    }
    addUsage(total, log.usage);
    addUsage(row, log.usage);
    const latency = log.attempts?.find((attempt) => attempt.ok)?.latencyMs || 0;
    total.latencyMs += latency;
    row.latencyMs += latency;
    row.lastUsedAt = log.ts;
  }
  return {
    total: finalizeUsageStats(total),
    subscriptions: [...rows.values()].map(finalizeUsageStats).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  };
}

function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
