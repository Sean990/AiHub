import { compactText, ensureApiKey, getJson, normalizeMessages, postJson } from "./common.js";
import { extractOpenAiModels } from "./codex.js";

const DEFAULT_BASE_URL = "https://api.openai.com";

export async function generate(subscription, request) {
  ensureApiKey(subscription);

  const body = {
    model: request.model || subscription.model,
    messages: normalizeMessages(request)
  };

  if (!body.model) {
    throw new Error(`Subscription "${subscription.name}" needs a model.`);
  }
  if (request.options?.temperature != null) {
    body.temperature = Number(request.options.temperature);
  }
  if (request.options?.maxTokens != null) {
    body.max_tokens = Number(request.options.maxTokens);
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.toolChoice) {
    body.tool_choice = request.toolChoice;
  }

  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const data = await postJson(openAiEndpoint(baseUrl, "/chat/completions"), {
    provider: "openai-compatible",
    subscription,
    headers: {
      authorization: `Bearer ${subscription.apiKey}`
    },
    timeoutMs: request.options?.timeoutMs || subscription.timeoutMs,
    body
  });

  return {
    text: extractOpenAiChatText(data),
    toolCalls: extractOpenAiChatToolCalls(data),
    usage: extractOpenAiChatUsage(data),
    raw: data
  };
}

export async function listModels(subscription, { timeoutMs } = {}) {
  ensureApiKey(subscription);
  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const data = await getJson(openAiEndpoint(baseUrl, "/models"), {
    provider: "openai-compatible",
    subscription,
    timeoutMs: timeoutMs || subscription.timeoutMs,
    headers: {
      authorization: `Bearer ${subscription.apiKey}`
    }
  });
  return extractOpenAiModels(data);
}

export function extractOpenAiChatText(data) {
  return compactText((data.choices || []).map((choice) => choice.message?.content || ""));
}

export function extractOpenAiChatToolCalls(data) {
  return (data.choices || []).flatMap((choice) => choice.message?.tool_calls || []);
}

export function extractOpenAiChatUsage(data) {
  const usage = data.usage || {};
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens
  };
}

function openAiEndpoint(baseUrl, path) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}${path}` : `${baseUrl}/v1${path}`;
}
