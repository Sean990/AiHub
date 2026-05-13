import { ensureApiKey, getJson } from "./common.js";

export async function queryProviderUsage(subscription, { timeoutMs } = {}) {
  ensureApiKey(subscription);
  const url = buildUsageUrl(subscription);
  const data = await getJson(url, {
    provider: subscription.provider,
    subscription,
    timeoutMs: timeoutMs || subscription.timeoutMs,
    headers: usageHeaders(subscription)
  });
  return normalizeProviderUsage(data, { url });
}

export function normalizeProviderUsage(data = {}, { url = "" } = {}) {
  const source = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
  const total = firstNumber(source, ["total", "quota", "limit", "monthlyLimit", "total_quota", "hard_limit_usd"]);
  const used = firstNumber(source, ["used", "usage", "usedCredits", "used_quota", "total_usage", "granted", "consumed"]);
  const remaining = firstNumber(source, ["remaining", "remain", "available", "balance", "left", "total_available"]);
  const resolvedTotal = total ?? (used != null && remaining != null ? used + remaining : null);
  const resolvedUsed = used ?? (resolvedTotal != null && remaining != null ? resolvedTotal - remaining : null);
  const resolvedRemaining = remaining ?? (resolvedTotal != null && resolvedUsed != null ? resolvedTotal - resolvedUsed : null);
  const utilization = resolvedTotal && resolvedUsed != null ? Math.max(0, Math.min(100, (resolvedUsed / resolvedTotal) * 100)) : null;

  return {
    ok: true,
    url,
    currency: firstString(source, ["currency", "unit"]) || "",
    total: resolvedTotal,
    used: resolvedUsed,
    remaining: resolvedRemaining,
    utilization,
    raw: data
  };
}

function buildUsageUrl(subscription) {
  if (subscription.usageUrl) {
    return subscription.usageUrl;
  }
  if (!subscription.baseUrl) {
    throw new Error("Usage URL is required when Base URL is empty.");
  }
  return `${subscription.baseUrl.replace(/\/+$/, "")}/v1/usage`;
}

function usageHeaders(subscription) {
  if (subscription.provider === "gemini") {
    return { "x-goog-api-key": subscription.apiKey };
  }
  if (subscription.provider === "claude") {
    return {
      "x-api-key": subscription.apiKey,
      "anthropic-version": subscription.apiVersion || "2023-06-01"
    };
  }
  return { authorization: `Bearer ${subscription.apiKey}` };
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const value = readPath(source, key);
    if (value == null || value === "") {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = readPath(source, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readPath(source, path) {
  return String(path).split(".").reduce((value, key) => value?.[key], source);
}
