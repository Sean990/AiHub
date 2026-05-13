export function emptyUsage() {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    latencyMs: 0
  };
}

export function normalizeUsage(usage = {}) {
  const inputTokens = numberValue(usage.inputTokens);
  const outputTokens = numberValue(usage.outputTokens);
  const explicitTotal = numberValue(usage.totalTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: explicitTotal || inputTokens + outputTokens,
    cachedInputTokens: numberValue(usage.cachedInputTokens),
    cacheWriteTokens: numberValue(usage.cacheWriteTokens),
    reasoningTokens: numberValue(usage.reasoningTokens)
  };
}

export function addUsage(target, usage = {}) {
  const normalized = normalizeUsage(usage);
  target.inputTokens += normalized.inputTokens;
  target.outputTokens += normalized.outputTokens;
  target.totalTokens += normalized.totalTokens;
  target.cachedInputTokens += normalized.cachedInputTokens;
  target.cacheWriteTokens += normalized.cacheWriteTokens;
  target.reasoningTokens += normalized.reasoningTokens;
  return target;
}

export function buildUsageStats(history = [], config = {}) {
  const total = emptyUsage();
  const subscriptions = new Map();

  for (const subscription of config.subscriptions || []) {
    subscriptions.set(subscription.name, {
      ...emptyUsage(),
      name: subscription.name,
      provider: subscription.provider,
      model: subscription.model,
      priority: subscription.priority,
      enabled: subscription.enabled,
      lastUsedAt: ""
    });
  }

  for (const entry of history) {
    const name = entry.subscription || "unknown";
    if (!subscriptions.has(name)) {
      subscriptions.set(name, {
        ...emptyUsage(),
        name,
        provider: entry.provider || "auto",
        model: entry.model || "",
        priority: 9999,
        enabled: false,
        lastUsedAt: ""
      });
    }

    const bucket = subscriptions.get(name);
    const ok = Boolean(entry.ok);
    total.requests += 1;
    bucket.requests += 1;
    if (ok) {
      total.successes += 1;
      bucket.successes += 1;
    } else {
      total.failures += 1;
      bucket.failures += 1;
    }

    addUsage(total, entry.usage);
    addUsage(bucket, entry.usage);

    const latency = averageLatencySource(entry);
    total.latencyMs += latency;
    bucket.latencyMs += latency;
    bucket.lastUsedAt = entry.ts || bucket.lastUsedAt;
  }

  const subscriptionRows = [...subscriptions.values()]
    .map(finalizeUsageStats)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  return {
    total: finalizeUsageStats(total),
    subscriptions: subscriptionRows
  };
}

export function finalizeUsageStats(stats) {
  const finalized = {
    ...stats,
    cacheHitRate: stats.inputTokens > 0 ? stats.cachedInputTokens / stats.inputTokens : 0,
    successRate: stats.requests > 0 ? stats.successes / stats.requests : 0,
    averageLatencyMs: stats.requests > 0 ? Math.round(stats.latencyMs / stats.requests) : 0
  };
  return finalized;
}

function averageLatencySource(entry) {
  const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
  const successful = attempts.find((attempt) => attempt.ok && Number.isFinite(Number(attempt.latencyMs)));
  return successful ? Number(successful.latencyMs) : 0;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
