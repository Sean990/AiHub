import { compactText, ensureApiKey, getJson, normalizeAnthropicConversation, openAiToolsToAnthropic, toolChoiceName, postJson } from "./common.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_API_VERSION = "2023-06-01";

export async function generate(subscription, request) {
  ensureApiKey(subscription);

  const { system, messages } = normalizeAnthropicConversation(request);

  const body = {
    model: request.model || subscription.model,
    max_tokens: Number(request.options?.maxTokens || 1024),
    messages
  };

  if (!body.model) {
    throw new Error(`Subscription "${subscription.name}" needs a model.`);
  }
  if (system) {
    body.system = system;
  }
  if (request.options?.temperature != null) {
    body.temperature = Number(request.options.temperature);
  }
  const tools = openAiToolsToAnthropic(request.tools || []);
  if (tools.length > 0) {
    body.tools = tools;
    const choiceName = toolChoiceName(request.toolChoice);
    if (choiceName) {
      body.tool_choice = { type: "tool", name: choiceName };
    }
  }

  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const data = await postJson(anthropicEndpoint(baseUrl, "/messages"), {
    provider: "claude",
    subscription,
    headers: {
      "x-api-key": subscription.apiKey,
      "anthropic-version": subscription.apiVersion || DEFAULT_API_VERSION
    },
    timeoutMs: request.options?.timeoutMs || subscription.timeoutMs,
    body
  });

  return {
    text: extractClaudeText(data),
    toolCalls: extractClaudeToolCalls(data),
    usage: extractClaudeUsage(data),
    raw: data
  };
}

function anthropicEndpoint(baseUrl, path) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}${path}` : `${baseUrl}/v1${path}`;
}

export function extractClaudeText(data) {
  return compactText((data.content || []).map((part) => part.text));
}

export function extractClaudeUsage(data) {
  const usage = data.usage || {};
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0),
    cachedInputTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens
  };
}

export function extractClaudeToolCalls(data) {
  return (data.content || [])
    .filter((part) => part.type === "tool_use")
    .map((part) => ({
      id: part.id,
      type: "function",
      function: {
        name: part.name,
        arguments: JSON.stringify(part.input || {})
      }
    }));
}

export async function listModels(subscription, { timeoutMs } = {}) {
  ensureApiKey(subscription);
  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const models = [];
  let afterId = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(anthropicEndpoint(baseUrl, "/models"));
    url.searchParams.set("limit", "1000");
    if (afterId) {
      url.searchParams.set("after_id", afterId);
    }
    const data = await getJson(url.toString(), {
      provider: "claude",
      subscription,
      timeoutMs: timeoutMs || subscription.timeoutMs,
      headers: {
        "x-api-key": subscription.apiKey,
        "anthropic-version": subscription.apiVersion || DEFAULT_API_VERSION
      }
    });
    models.push(...extractClaudeModels(data));
    if (!data.has_more || !data.last_id) {
      break;
    }
    afterId = data.last_id;
  }
  return [...new Set(models)].sort();
}

export function extractClaudeModels(data) {
  return [...new Set((data.data || []).map((model) => model.id).filter(Boolean))].sort();
}
