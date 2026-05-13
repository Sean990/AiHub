import { redactSubscription } from "./config.js";
import { appendHistory, buildHistoryEntry } from "./history.js";
import { providers } from "./providers/index.js";
import { readStoreConfig } from "./store.js";

export async function routeChat(request, { config, configPath, platformKey } = {}) {
  const activeConfig = config || (await readStoreConfig(configPath));
  const trackedRequest = { ...request, platformKey };
  const candidates = selectSubscriptions(activeConfig, request);
  const attempts = [];

  if (candidates.length === 0) {
    throw new Error("No enabled subscription matches this request.");
  }

  for (const subscription of candidates) {
    const provider = providers[subscription.provider];
    if (!provider) {
      attempts.push({
        subscription: subscription.name,
        provider: subscription.provider,
        ok: false,
        error: "Provider is not implemented."
      });
      continue;
    }

    const retryAttempts = normalizeRetryAttempts(request.options?.retryAttempts ?? activeConfig.routing.retryAttempts);
    const maxAttempts = retryAttempts + 1;
    for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex += 1) {
      const startedAt = Date.now();
      const providerRequest = {
        ...request,
        model: subscription.alias ? subscription.model : request.model,
        options: {
          ...(request.options || {}),
          timeoutMs: request.options?.timeoutMs || subscription.timeoutMs || activeConfig.routing.requestTimeoutMs
        }
      };
      try {
        const result = await provider.generate(subscription, providerRequest);
        const routedResult = {
          provider: subscription.provider,
          subscription: subscription.name,
          alias: subscription.alias || "",
          model: subscription.alias || request.model || subscription.model,
          providerModel: subscription.model,
          platformKey,
          text: result.text,
          toolCalls: result.toolCalls,
          usage: result.usage,
          raw: request.includeRaw ? result.raw : undefined,
          attempts: [
            ...attempts,
            {
              subscription: subscription.name,
              provider: subscription.provider,
              ok: true,
              attempt: attemptIndex,
              retry: Math.max(0, attemptIndex - 1),
              maxRetries: retryAttempts,
              maxAttempts,
              latencyMs: Date.now() - startedAt
            }
          ]
        };
        await appendHistory(buildHistoryEntry({ request: trackedRequest, result: routedResult, config: activeConfig }), {
          config: activeConfig,
          configPath
        });
        return routedResult;
      } catch (error) {
        attempts.push({
          subscription: subscription.name,
          provider: subscription.provider,
          ok: false,
          attempt: attemptIndex,
          retry: Math.max(0, attemptIndex - 1),
          maxRetries: retryAttempts,
          maxAttempts,
          status: error.status,
          latencyMs: Date.now() - startedAt,
          error: error.message
        });
      }
    }

    if (request.subscription || activeConfig.routing.fallback === false) {
      break;
    }
  }

  const message = summarizeAttempts(attempts);
  const error = new Error(`All matching subscriptions failed. ${message}`);
  error.attempts = attempts;
  await appendHistory(buildHistoryEntry({ request: trackedRequest, error, attempts, config: activeConfig }), {
    config: activeConfig,
    configPath
  });
  throw error;
}

export function normalizeRetryAttempts(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 5;
  }
  return Math.min(parsed, 20);
}

function summarizeAttempts(attempts) {
  const bySubscription = new Map();
  for (const attempt of attempts) {
    if (!bySubscription.has(attempt.subscription)) {
      bySubscription.set(attempt.subscription, []);
    }
    bySubscription.get(attempt.subscription).push(attempt);
  }
  return [...bySubscription.entries()]
    .map(([subscription, rows]) => {
      const last = rows[rows.length - 1];
      const retries = Math.max(0, rows.length - 1);
      return `${subscription}: failed after ${retries} retry(s), last error: ${last?.error || "unknown"}`;
    })
    .join("; ");
}

export function selectSubscriptions(config, request = {}) {
  const requestedProvider = request.provider && request.provider !== "auto" ? request.provider : "";
  const requestedSubscription = request.subscription || "";
  const alias = (config.modelAliases || []).find((item) => item.enabled && item.alias === request.model);

  if (alias) {
    const byName = new Map(config.subscriptions.map((subscription) => [subscription.name, subscription]));
    return alias.routes
      .filter((route) => route.enabled)
      .map((route) => {
        const subscription = byName.get(route.subscriptionName);
        if (!subscription || !subscription.enabled) {
          return null;
        }
        return {
          ...subscription,
          model: route.providerModel || subscription.model,
          alias: alias.alias,
          routeId: route.id,
          routePriority: route.priority
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.routePriority - b.routePriority || a.priority - b.priority || a.name.localeCompare(b.name));
  }

  return config.subscriptions
    .filter((subscription) => subscription.enabled)
    .filter((subscription) => !requestedProvider || subscription.provider === requestedProvider)
    .filter((subscription) => !requestedSubscription || subscription.name === requestedSubscription)
    .filter((subscription, _index, subscriptions) => {
      if (!request.model || requestedSubscription) {
        return true;
      }
      const anyDeclaredMatch = subscriptions.some((item) => subscriptionSupportsModel(item, request.model));
      return anyDeclaredMatch ? subscriptionSupportsModel(subscription, request.model) : true;
    })
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function listSafeSubscriptions(config) {
  return config.subscriptions.map(redactSubscription);
}

function subscriptionSupportsModel(subscription, model) {
  const models = new Set([subscription.model, ...(subscription.models || [])].filter(Boolean));
  return models.has(model);
}
