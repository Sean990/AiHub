import { compactText, ensureApiKey, getJson, normalizeGeminiConversation, openAiToolsToGemini, postJson } from "./common.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export async function generate(subscription, request) {
  ensureApiKey(subscription);

  const { system, contents } = normalizeGeminiConversation(request);

  const model = request.model || subscription.model;
  if (!model) {
    throw new Error(`Subscription "${subscription.name}" needs a model.`);
  }

  const body = { contents };
  if (system) {
    body.systemInstruction = {
      parts: [{ text: system }]
    };
  }
  if (request.options?.temperature != null || request.options?.maxTokens != null) {
    body.generationConfig = {};
    if (request.options.temperature != null) {
      body.generationConfig.temperature = Number(request.options.temperature);
    }
    if (request.options.maxTokens != null) {
      body.generationConfig.maxOutputTokens = Number(request.options.maxTokens);
    }
  }
  const tools = openAiToolsToGemini(request.tools || []);
  if (tools) {
    body.tools = tools;
  }

  const modelPath = model.startsWith("models/") ? model.slice("models/".length) : model;
  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const data = await postJson(`${baseUrl}/models/${encodeURIComponent(modelPath)}:generateContent`, {
    provider: "gemini",
    subscription,
    headers: {
      "x-goog-api-key": subscription.apiKey
    },
    timeoutMs: request.options?.timeoutMs || subscription.timeoutMs,
    body
  });

  return {
    text: extractGeminiText(data),
    toolCalls: extractGeminiToolCalls(data),
    usage: extractGeminiUsage(data),
    raw: data
  };
}

export function extractGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return compactText(parts.map((part) => part.text));
}

export function extractGeminiUsage(data) {
  const usage = data.usageMetadata || {};
  return {
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
    cachedInputTokens: usage.cachedContentTokenCount,
    reasoningTokens: usage.thoughtsTokenCount
  };
}

export function extractGeminiToolCalls(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.functionCall)
    .map((part, index) => ({
      id: `call_${index}`,
      type: "function",
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args || {})
      }
    }));
}

export async function listModels(subscription, { timeoutMs } = {}) {
  ensureApiKey(subscription);
  const baseUrl = subscription.baseUrl || DEFAULT_BASE_URL;
  const models = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${baseUrl}/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const data = await getJson(url.toString(), {
      provider: "gemini",
      subscription,
      timeoutMs: timeoutMs || subscription.timeoutMs,
      headers: {
        "x-goog-api-key": subscription.apiKey
      }
    });
    models.push(...extractGeminiModels(data));
    if (!data.nextPageToken) {
      break;
    }
    pageToken = data.nextPageToken;
  }
  return [...new Set(models)].sort();
}

export function extractGeminiModels(data) {
  return [...new Set((data.models || [])
    .filter((model) => {
      const methods = model.supportedGenerationMethods || [];
      return methods.length === 0 || methods.includes("generateContent");
    })
    .map((model) => model.name || model.id)
    .filter(Boolean)
    .map((name) => name.startsWith("models/") ? name.slice("models/".length) : name))]
    .sort();
}
