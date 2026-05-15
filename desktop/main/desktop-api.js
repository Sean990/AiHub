import {
  getConfigPath,
  redactSubscription,
  removeSubscription,
  setRoutingFallback,
  setRoutingRetryAttempts,
  setRoutingTimeout,
  setServiceAddress,
  setSubscriptionEnabled,
  setSubscriptionPriority,
  upsertSubscription
} from "../../src/config.js";
import { readHistory } from "../../src/history.js";
import { providers } from "../../src/providers/index.js";
import { queryProviderUsage } from "../../src/providers/usage-query.js";
import { listSafeSubscriptions, routeChat } from "../../src/router.js";
import {
  buildStoreUsageStats,
  createPlatformKey,
  deleteModelAlias,
  deleteModelRoute,
  deletePlatformKey,
  exportStore,
  importStore,
  listModelAliases,
  listPlatformKeys,
  migrationStatus,
  readStoreConfig,
  setModelAliasEnabled,
  setPlatformKeyEnabled,
  updatePlatformKey,
  updateStoreConfig,
  upsertModelAlias,
  upsertModelRoute
} from "../../src/store.js";
import {
  getManagedServiceStatus,
  readDesktopLog,
  startManagedService,
  stopManagedService
} from "./service-controller.js";

export async function readDesktopConfig() {
  return serializeConfig(await readStoreConfig());
}

export async function getDesktopConfigPath() {
  return getConfigPath();
}

export async function setDesktopService(payload) {
  const config = await updateStoreConfig((current) => setServiceAddress(current, payload || {}));
  return serializeConfig(config);
}

export async function setDesktopFallback(enabled) {
  const config = await updateStoreConfig((current) => setRoutingFallback(current, Boolean(enabled)));
  return serializeConfig(config);
}

export async function setDesktopRequestTimeout(timeoutMs) {
  const config = await updateStoreConfig((current) => setRoutingTimeout(current, Number(timeoutMs)));
  return serializeConfig(config);
}

export async function setDesktopRetryAttempts(retryAttempts) {
  const config = await updateStoreConfig((current) => setRoutingRetryAttempts(current, Number(retryAttempts)));
  return serializeConfig(config);
}

export async function setDesktopLogging(payload = {}) {
  const config = await updateStoreConfig((current) => {
    const next = {
      ...current,
      logging: {
        ...current.logging,
        ...(typeof payload.enabled === "boolean" ? { enabled: payload.enabled } : {}),
        ...(typeof payload.includePrompt === "boolean" ? { includePrompt: payload.includePrompt } : {})
      }
    };
    return next;
  });
  return serializeConfig(config);
}

export async function upsertDesktopSubscription(subscription) {
  const config = await updateStoreConfig((current) => {
    const originalName = subscription.originalName || subscription.name;
    const targetExists = current.subscriptions.some((item) => item.name === subscription.name);
    if (originalName && originalName !== subscription.name && targetExists) {
      throw new Error(`Subscription "${subscription.name}" already exists.`);
    }
    if (originalName && originalName !== subscription.name) {
      removeSubscription(current, originalName);
    }
    const existing = current.subscriptions.find((item) => item.name === subscription.name);
    const { originalName: _originalName, ...payload } = subscription;
    return upsertSubscription(current, {
      ...existing,
      ...payload,
      apiKey: payload.apiKey || existing?.apiKey || ""
    });
  });
  return serializeConfig(config);
}

export async function removeDesktopSubscription(name) {
  const config = await updateStoreConfig((current) => removeSubscription(current, name));
  return serializeConfig(config);
}

export async function setDesktopSubscriptionEnabled({ name, enabled }) {
  const config = await updateStoreConfig((current) => setSubscriptionEnabled(current, name, Boolean(enabled)));
  return serializeConfig(config);
}

export async function setDesktopSubscriptionPriority({ name, priority }) {
  const config = await updateStoreConfig((current) => setSubscriptionPriority(current, name, Number(priority)));
  return serializeConfig(config);
}

export async function fetchDesktopSubscriptionModels(name) {
  const config = await readStoreConfig();
  const subscription = resolveSubscriptionInput(name, config);
  const provider = providers[subscription.provider];
  if (!provider?.listModels) {
    throw new Error(`Provider "${subscription.provider}" does not support model discovery.`);
  }
  const models = await provider.listModels(subscription, {
    timeoutMs: subscription.timeoutMs || config.routing.requestTimeoutMs
  });
  if (typeof name !== "string") {
    return { models, config: serializeConfig(config) };
  }
  const nextConfig = await updateStoreConfig((current) => {
    const existing = current.subscriptions.find((item) => item.name === name);
    return upsertSubscription(current, {
      ...existing,
      models,
      model: existing?.model || models[0] || "",
      apiKey: existing?.apiKey || ""
    });
  });
  return {
    models,
    config: serializeConfig(nextConfig)
  };
}

export async function testDesktopSubscriptionConnection(input) {
  const config = await readStoreConfig();
  const subscription = resolveSubscriptionInput(input, config);
  const provider = providers[subscription.provider];
  if (!provider?.listModels) {
    throw new Error(`Provider "${subscription.provider}" does not support model discovery.`);
  }
  const startedAt = Date.now();
  const models = await provider.listModels(subscription, {
    timeoutMs: subscription.timeoutMs || config.routing.requestTimeoutMs
  });
  return {
    ok: true,
    provider: subscription.provider,
    name: subscription.name,
    modelCount: models.length,
    sampleModels: models.slice(0, 8),
    latencyMs: Date.now() - startedAt
  };
}

export async function queryDesktopSubscriptionUsage(input) {
  const config = await readStoreConfig();
  const subscription = resolveSubscriptionInput(input, config);
  const startedAt = Date.now();
  const usage = await queryProviderUsage(subscription, {
    timeoutMs: subscription.timeoutMs || config.routing.requestTimeoutMs
  });
  return {
    ...usage,
    name: subscription.name,
    provider: subscription.provider,
    queriedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt
  };
}

export async function readDesktopHistory(payload) {
  return readHistory({ limit: payload?.limit || 50 });
}

export async function readDesktopUsage(payload) {
  return buildStoreUsageStats(payload?.configPath || getConfigPath());
}

export async function readDesktopLogs(payload) {
  return readDesktopLog({ lines: payload?.lines || 120 });
}

export async function sendDesktopChat(request) {
  const config = await readStoreConfig();
  return routeChat(request, { config, configPath: getConfigPath() });
}

export async function readDesktopPlatformKeys() {
  return listPlatformKeys();
}

export async function createDesktopPlatformKey(payload) {
  return createPlatformKey(payload);
}

export async function updateDesktopPlatformKey(payload) {
  return updatePlatformKey(payload.id, payload);
}

export async function setDesktopPlatformKeyEnabled(payload) {
  return setPlatformKeyEnabled(payload.id, Boolean(payload.enabled));
}

export async function deleteDesktopPlatformKey(id) {
  return deletePlatformKey(id);
}

export async function readDesktopModelAliases() {
  return listModelAliases();
}

export async function upsertDesktopModelAlias(payload) {
  return upsertModelAlias(payload);
}

export async function setDesktopModelAliasEnabled(payload) {
  return setModelAliasEnabled(payload.alias, Boolean(payload.enabled));
}

export async function deleteDesktopModelAlias(alias) {
  return deleteModelAlias(alias);
}

export async function upsertDesktopModelRoute(payload) {
  return upsertModelRoute(payload);
}

export async function deleteDesktopModelRoute(id) {
  return deleteModelRoute(id);
}

export async function exportDesktopStore(payload) {
  return exportStore({ includeProviderKeys: Boolean(payload?.includeProviderKeys) });
}

export async function importDesktopStore(payload) {
  return importStore(payload);
}

export async function readDesktopMigrationStatus() {
  return migrationStatus();
}

export {
  getManagedServiceStatus,
  startManagedService,
  stopManagedService
};

function serializeConfig(config) {
  return {
    ...config,
    subscriptions: listSafeSubscriptions(config).map(redactSubscription)
  };
}

function resolveSubscriptionInput(input, config) {
  if (typeof input === "string") {
    const subscription = config.subscriptions.find((item) => item.name === input);
    if (!subscription) {
      throw new Error(`Subscription "${input}" was not found.`);
    }
    return subscription;
  }

  const existing = input?.name ? config.subscriptions.find((item) => item.name === input.name) : null;
  const subscription = {
    ...existing,
    ...(input || {}),
    apiKey: input?.apiKey || existing?.apiKey || ""
  };
  if (!subscription.name) {
    subscription.name = "connection-test";
  }
  return subscription;
}
