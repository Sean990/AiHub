import { compactText, ensureApiKey, getJson, normalizeCodexInput, postJson } from "./common.js";

const DEFAULT_BASE_URL = "https://api.openai.com";

export async function generate(subscription, request) {
  ensureApiKey(subscription);

  const body = {
    model: request.model || subscription.model,
    input: normalizeCodexInput(request)
  };

  if (!body.model) {
    throw new Error(`Subscription "${subscription.name}" needs a model.`);
  }
  if (request.options?.temperature != null) {
    body.temperature = Number(request.options.temperature);
  }
  if (request.options?.maxTokens != null) {
    body.max_output_tokens = Number(request.options.maxTokens);
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.toolChoice) {
    body.tool_choice = request.toolChoice;
  }

  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const data = await postJson(openAiEndpoint(baseUrl, "/responses"), {
    provider: "codex",
    subscription,
    headers: {
      authorization: `Bearer ${subscription.apiKey}`
    },
    timeoutMs: request.options?.timeoutMs || subscription.timeoutMs,
    body
  });

  return {
    text: extractCodexText(data),
    toolCalls: extractCodexToolCalls(data),
    usage: extractCodexUsage(data),
    raw: data
  };
}

function openAiEndpoint(baseUrl, path) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}${path}` : `${baseUrl}/v1${path}`;
}

export function extractCodexText(data) {
  if (data.output_text) {
    return data.output_text;
  }

  const pieces = [];
  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return compactText(pieces);
}

export function extractCodexUsage(data) {
  const usage = data.usage || {};
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens
  };
}

export function extractCodexToolCalls(data) {
  const calls = [];
  for (const output of data.output || []) {
    if (output.type === "function_call") {
      calls.push({
        id: output.call_id || output.id || `call_${calls.length}`,
        type: "function",
        function: {
          name: output.name,
          arguments: typeof output.arguments === "string" ? output.arguments : JSON.stringify(output.arguments || {})
        }
      });
    }
  }
  return calls;
}

export async function listModels(subscription, { timeoutMs } = {}) {
  ensureApiKey(subscription);
  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const data = await getJson(openAiEndpoint(baseUrl, "/models"), {
    provider: "codex",
    subscription,
    timeoutMs: timeoutMs || subscription.timeoutMs,
    headers: {
      authorization: `Bearer ${subscription.apiKey}`
    }
  });
  return extractOpenAiModels(data);
}

export function extractOpenAiModels(data) {
  return [...new Set((data.data || []).map((model) => model.id).filter(Boolean))].sort();
}
