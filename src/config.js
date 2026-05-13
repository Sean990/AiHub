import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SUPPORTED_PROVIDERS = new Set(["gemini", "claude", "codex", "openai-compatible"]);

export function getConfigPath() {
  return process.env.AIHUB_CONFIG || path.join(os.homedir(), ".aihub", "config.json");
}

export function getDataDir(configPath = getConfigPath()) {
  return process.env.AIHUB_HOME || path.dirname(configPath);
}

export function getPidPath(configPath = getConfigPath()) {
  return process.env.AIHUB_PID || path.join(getDataDir(configPath), "aihub.pid");
}

export function getLogPath(configPath = getConfigPath()) {
  return process.env.AIHUB_LOG || path.join(getDataDir(configPath), "aihub.log");
}

export function getHistoryPath(configPath = getConfigPath()) {
  return process.env.AIHUB_HISTORY || path.join(getDataDir(configPath), "history.jsonl");
}

export function defaultConfig() {
  return {
    version: 1,
    service: {
      host: "127.0.0.1",
      port: 8787
    },
    routing: {
      fallback: true,
      requestTimeoutMs: 120000,
      retryAttempts: 5
    },
    logging: {
      enabled: true,
      includePrompt: false
    },
    subscriptions: []
  };
}

export async function readConfig(configPath = getConfigPath()) {
  try {
    const raw = await readFile(configPath, "utf8");
    if (!raw.trim()) {
      return defaultConfig();
    }
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultConfig();
    }
    throw new Error(`Failed to read config at ${configPath}: ${error.message}`);
  }
}

export async function writeConfig(config, configPath = getConfigPath()) {
  const normalized = normalizeConfig(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    mode: 0o600
  });
  return normalized;
}

export async function updateConfig(mutator, configPath = getConfigPath()) {
  const config = await readConfig(configPath);
  const next = await mutator(config);
  return writeConfig(next || config, configPath);
}

export function normalizeConfig(config) {
  const base = defaultConfig();
  const normalized = {
    ...base,
    ...config,
    service: {
      ...base.service,
      ...(config?.service || {})
    },
    routing: {
      ...base.routing,
      ...(config?.routing || {})
    },
    logging: {
      ...base.logging,
      ...(config?.logging || {})
    },
    subscriptions: Array.isArray(config?.subscriptions) ? config.subscriptions : []
  };

  normalized.subscriptions = normalized.subscriptions
    .map(normalizeSubscription)
    .sort(compareSubscriptions);

  return normalized;
}

export function normalizeSubscription(subscription) {
  const provider = String(subscription.provider || "").toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported provider "${subscription.provider}". Use gemini, claude, codex, or openai-compatible.`);
  }

  if (!subscription.name) {
    throw new Error("Subscription name is required.");
  }

  return {
    name: String(subscription.name),
    provider,
    apiKey: String(subscription.apiKey || ""),
    model: primaryModel(subscription),
    models: normalizeModels(subscription),
    priority: Number.isFinite(Number(subscription.priority)) ? Number(subscription.priority) : 100,
    enabled: subscription.enabled !== false,
    baseUrl: subscription.baseUrl ? String(subscription.baseUrl).replace(/\/+$/, "") : "",
    usageUrl: subscription.usageUrl ? String(subscription.usageUrl).trim() : "",
    apiVersion: subscription.apiVersion ? String(subscription.apiVersion) : "",
    website: subscription.website ? String(subscription.website).trim() : "",
    notes: subscription.notes ? String(subscription.notes).trim() : "",
    timeoutMs: Number.isFinite(Number(subscription.timeoutMs)) ? Number(subscription.timeoutMs) : 0,
    tags: Array.isArray(subscription.tags) ? subscription.tags.map(String) : []
  };
}

function normalizeModels(subscription) {
  const values = Array.isArray(subscription.models)
    ? subscription.models
    : typeof subscription.models === "string"
      ? subscription.models.split(/[\n,]/)
      : [];
  if (subscription.model) {
    values.unshift(subscription.model);
  }
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function primaryModel(subscription) {
  if (subscription.model) {
    return String(subscription.model).trim();
  }
  if (Array.isArray(subscription.models) && subscription.models.length > 0) {
    return String(subscription.models[0]).trim();
  }
  if (typeof subscription.models === "string") {
    return subscription.models.split(/[\n,]/).map((value) => value.trim()).find(Boolean) || "";
  }
  return "";
}

export function compareSubscriptions(a, b) {
  if (a.enabled !== b.enabled) {
    return a.enabled ? -1 : 1;
  }
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  return a.name.localeCompare(b.name);
}

export function redactSubscription(subscription) {
  return {
    ...subscription,
    apiKey: redactSecret(subscription.apiKey)
  };
}

export function redactSecret(value) {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function upsertSubscription(config, subscription) {
  const normalized = normalizeSubscription(subscription);
  const existingIndex = config.subscriptions.findIndex((item) => item.name === normalized.name);
  if (existingIndex >= 0) {
    config.subscriptions[existingIndex] = {
      ...config.subscriptions[existingIndex],
      ...normalized
    };
  } else {
    config.subscriptions.push(normalized);
  }
  config.subscriptions.sort(compareSubscriptions);
  return config;
}

export function removeSubscription(config, name) {
  const before = config.subscriptions.length;
  config.subscriptions = config.subscriptions.filter((item) => item.name !== name);
  if (before === config.subscriptions.length) {
    throw new Error(`Subscription "${name}" was not found.`);
  }
  return config;
}

export function setSubscriptionEnabled(config, name, enabled) {
  const subscription = config.subscriptions.find((item) => item.name === name);
  if (!subscription) {
    throw new Error(`Subscription "${name}" was not found.`);
  }
  subscription.enabled = enabled;
  config.subscriptions.sort(compareSubscriptions);
  return config;
}

export function setSubscriptionPriority(config, name, priority) {
  const subscription = config.subscriptions.find((item) => item.name === name);
  if (!subscription) {
    throw new Error(`Subscription "${name}" was not found.`);
  }
  subscription.priority = Number(priority);
  config.subscriptions.sort(compareSubscriptions);
  return config;
}

export function setRoutingFallback(config, enabled) {
  config.routing = {
    ...defaultConfig().routing,
    ...(config.routing || {}),
    fallback: enabled
  };
  return config;
}

export function setRoutingTimeout(config, timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Routing timeout must be a positive integer in milliseconds.");
  }
  config.routing = {
    ...defaultConfig().routing,
    ...(config.routing || {}),
    requestTimeoutMs: parsed
  };
  return config;
}

export function setRoutingRetryAttempts(config, retryAttempts) {
  const parsed = Number(retryAttempts);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error("Routing retry attempts must be an integer between 1 and 20.");
  }
  config.routing = {
    ...defaultConfig().routing,
    ...(config.routing || {}),
    retryAttempts: parsed
  };
  return config;
}

export function setServiceAddress(config, { host, port }) {
  config.service = {
    ...defaultConfig().service,
    ...(config.service || {})
  };
  if (host) {
    config.service.host = String(host);
  }
  if (port != null) {
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      throw new Error("Service port must be an integer between 1 and 65535.");
    }
    config.service.port = parsedPort;
  }
  return config;
}
