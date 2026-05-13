export class ProviderError extends Error {
  constructor(message, { status, provider, subscription, responseBody, cause } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.provider = provider;
    this.subscription = subscription;
    this.responseBody = responseBody;
    this.cause = cause;
  }
}

export function ensureApiKey(subscription) {
  if (!subscription.apiKey) {
    throw new ProviderError(`Subscription "${subscription.name}" has no API key.`, {
      provider: subscription.provider,
      subscription: subscription.name
    });
  }
}

export async function postJson(url, { headers, body, provider, subscription, timeoutMs }) {
  let response;
  let text;
  try {
    const signal = timeoutMs ? AbortSignal.timeout(Number(timeoutMs)) : undefined;
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      signal,
      body: JSON.stringify(body)
    });
    text = await response.text();
  } catch (error) {
    throw new ProviderError(`${provider} request failed: ${error.message}`, {
      provider,
      subscription: subscription.name,
      cause: error
    });
  }

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new ProviderError(`${provider} returned ${response.status}: ${detail}`, {
      status: response.status,
      provider,
      subscription: subscription.name,
      responseBody: data
    });
  }

  return data;
}

export async function getJson(url, { headers, provider, subscription, timeoutMs }) {
  let response;
  let text;
  try {
    const signal = timeoutMs ? AbortSignal.timeout(Number(timeoutMs)) : undefined;
    response = await fetch(url, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      signal
    });
    text = await response.text();
  } catch (error) {
    throw new ProviderError(`${provider} request failed: ${error.message}`, {
      provider,
      subscription: subscription.name,
      cause: error
    });
  }

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new ProviderError(`${provider} returned ${response.status}: ${detail}`, {
      status: response.status,
      provider,
      subscription: subscription.name,
      responseBody: data
    });
  }

  return data;
}

export function normalizeMessages(request) {
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    return request.messages.map((message) => ({
      role: normalizeRole(message.role),
      content: contentToText(message.content)
    }));
  }

  if (request.prompt) {
    return [{ role: "user", content: String(request.prompt) }];
  }

  throw new Error("A prompt or messages array is required.");
}

export function normalizeCodexInput(request) {
  const messages = rawMessages(request);
  return messages.flatMap((message) => {
    if (message.role === "tool") {
      return [{
        type: "function_call_output",
        call_id: message.tool_call_id || message.call_id || "",
        output: contentToText(message.content)
      }];
    }
    const items = [];
    const content = contentToText(message.content);
    if (content || !Array.isArray(message.tool_calls)) {
      items.push({
        role: message.role === "system" ? "developer" : normalizeRole(message.role),
        content
      });
    }
    for (const call of message.tool_calls || []) {
      if (call?.type === "function" && call.function?.name) {
        items.push({
          type: "function_call",
          call_id: call.id || "",
          name: call.function.name,
          arguments: stringifyToolArguments(call.function.arguments)
        });
      }
    }
    return items;
  });
}

export function normalizeAnthropicConversation(request) {
  const system = [];
  const messages = [];
  for (const message of rawMessages(request)) {
    if (message.role === "system" || message.role === "developer") {
      system.push(contentToText(message.content));
      continue;
    }
    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.tool_call_id || message.call_id || "",
          content: contentToText(message.content)
        }]
      });
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const content = [];
      const text = contentToText(message.content);
      if (text) {
        content.push({ type: "text", text });
      }
      for (const call of message.tool_calls) {
        if (call?.type === "function" && call.function?.name) {
          content.push({
            type: "tool_use",
            id: call.id || "",
            name: call.function.name,
            input: parseToolArguments(call.function.arguments)
          });
        }
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: contentToText(message.content)
    });
  }
  return {
    system: compactText(system),
    messages
  };
}

export function normalizeGeminiConversation(request) {
  const system = [];
  const contents = [];
  for (const message of rawMessages(request)) {
    if (message.role === "system" || message.role === "developer") {
      system.push(contentToText(message.content));
      continue;
    }
    if (message.role === "tool") {
      contents.push({
        role: "function",
        parts: [{
          functionResponse: {
            name: message.name || message.tool_name || message.tool_call_id || "tool_result",
            response: {
              content: contentToText(message.content)
            }
          }
        }]
      });
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const parts = [];
      const text = contentToText(message.content);
      if (text) {
        parts.push({ text });
      }
      for (const call of message.tool_calls) {
        if (call?.type === "function" && call.function?.name) {
          parts.push({
            functionCall: {
              name: call.function.name,
              args: parseToolArguments(call.function.arguments)
            }
          });
        }
      }
      contents.push({ role: "model", parts });
      continue;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: contentToText(message.content) }]
    });
  }
  return {
    system: compactText(system),
    contents
  };
}

export function openAiToolsToAnthropic(tools = []) {
  return tools
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || "",
      input_schema: tool.function.parameters || { type: "object", properties: {} }
    }));
}

export function openAiToolsToGemini(tools = []) {
  const declarations = tools
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || "",
      parameters: tool.function.parameters || { type: "object", properties: {} }
    }));
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined;
}

export function toolChoiceName(toolChoice) {
  if (!toolChoice || typeof toolChoice === "string") {
    return "";
  }
  return toolChoice.function?.name || "";
}

export function contentToText(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return compactText(content.map(contentToText));
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    if (typeof content.input_text === "string") {
      return content.input_text;
    }
    if (typeof content.output_text === "string") {
      return content.output_text;
    }
    if (typeof content.content === "string") {
      return content.content;
    }
  }
  return String(content);
}

export function normalizeRole(role) {
  if (role === "assistant" || role === "model") {
    return "assistant";
  }
  if (role === "system" || role === "developer") {
    return "system";
  }
  return "user";
}

export function compactText(parts) {
  return parts.filter(Boolean).join("\n").trim();
}

function rawMessages(request) {
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    return request.messages;
  }
  if (request.prompt) {
    return [{ role: "user", content: String(request.prompt) }];
  }
  throw new Error("A prompt or messages array is required.");
}

function parseToolArguments(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return { value: String(value) };
  }
}

function stringifyToolArguments(value) {
  return typeof value === "string" ? value : JSON.stringify(value || {});
}
