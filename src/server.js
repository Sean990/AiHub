import http from "node:http";
import { readHistory } from "./history.js";
import { listSafeSubscriptions, routeChat } from "./router.js";
import {
  authenticatePlatformKey,
  buildStoreUsageStats,
  createPlatformKey,
  deleteModelAlias,
  deleteModelRoute,
  deletePlatformKey,
  exportStore,
  importStore,
  listModelAliases,
  listPlatformKeys,
  readStoreConfig,
  setModelAliasEnabled,
  setPlatformKeyEnabled,
  updatePlatformKey,
  upsertModelAlias,
  upsertModelRoute
} from "./store.js";

export async function createServer({ configPath } = {}) {
  return http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { configPath });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: {
          message: error.message,
          attempts: error.attempts
        }
      });
    }
  });
}

export async function startServer({ host, port, configPath } = {}) {
  const config = await readStoreConfig(configPath);
  const activeHost = host || config.service.host;
  const activePort = Number(port || config.service.port);
  const server = await createServer({ configPath });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(activePort, activeHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return { server, host: activeHost, port: activePort };
}

async function handleRequest(req, res, { configPath }) {
  if (req.method === "OPTIONS") {
    sendCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    const config = await readStoreConfig(configPath);
    sendJson(res, 200, {
      ok: true,
      subscriptions: config.subscriptions.filter((subscription) => subscription.enabled).length
    });
    return;
  }

  if (url.pathname.startsWith("/v1/admin/")) {
    await handleAdminRequest(req, res, { url, configPath });
    return;
  }

  const platformKey = await authenticatePlatformKey(req.headers.authorization || "", configPath);

  if (req.method === "GET" && url.pathname === "/v1/subscriptions") {
    const config = await readStoreConfig(configPath);
    sendJson(res, 200, { data: listSafeSubscriptions(config) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const config = await readStoreConfig(configPath);
    sendJson(res, 200, configToOpenAiModels(config));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/history") {
    sendJson(res, 200, {
      data: await readHistory({ limit: Number(url.searchParams.get("limit") || 20), configPath })
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage") {
    sendJson(res, 200, await buildStoreUsageStats(configPath));
    return;
  }

  if (req.method === "POST" && (url.pathname === "/v1/chat" || url.pathname === "/v1/messages")) {
    const body = await readJson(req);
    const result = await routeChat(body, { config: await readStoreConfig(configPath), configPath, platformKey });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJson(req);
    const result = await routeChat(openAiChatToRouteRequest(body), {
      config: await readStoreConfig(configPath),
      configPath,
      platformKey
    });
    if (body.stream) {
      sendOpenAiChatStream(res, result);
      return;
    }
    sendJson(res, 200, routeResultToOpenAiChat(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    const body = await readJson(req);
    const result = await routeChat(openAiResponseToRouteRequest(body), {
      config: await readStoreConfig(configPath),
      configPath,
      platformKey
    });
    if (body.stream) {
      sendOpenAiResponseStream(res, result);
      return;
    }
    sendJson(res, 200, routeResultToOpenAiResponse(result));
    return;
  }

  sendJson(res, 404, { error: { message: "Not found" } });
}

async function handleAdminRequest(req, res, { url, configPath }) {
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[2];
  const id = parts[3];

  if (resource === "platform-keys") {
    if (req.method === "GET") {
      sendJson(res, 200, { data: await listPlatformKeys(configPath) });
      return;
    }
    if (req.method === "POST") {
      sendJson(res, 201, await createPlatformKey(await readJson(req), configPath));
      return;
    }
    if (req.method === "PATCH" && id) {
      const body = await readJson(req);
      if (
        body.name != null ||
        body.monthlyRequestQuota != null ||
        body.monthlyTokenQuota != null
      ) {
        sendJson(res, 200, { data: await updatePlatformKey(id, body, configPath) });
        return;
      }
      sendJson(res, 200, { data: await setPlatformKeyEnabled(id, body.enabled !== false, configPath) });
      return;
    }
    if (req.method === "DELETE" && id) {
      sendJson(res, 200, { data: await deletePlatformKey(id, configPath) });
      return;
    }
  }

  if (resource === "model-aliases") {
    if (req.method === "GET") {
      sendJson(res, 200, { data: await listModelAliases(configPath) });
      return;
    }
    if (req.method === "POST") {
      sendJson(res, 201, { data: await upsertModelAlias(await readJson(req), configPath) });
      return;
    }
    if (req.method === "PATCH" && id) {
      const body = await readJson(req);
      if (body.route) {
        sendJson(res, 200, { data: await upsertModelRoute({ ...body.route, alias: id }, configPath) });
        return;
      }
      sendJson(res, 200, { data: await setModelAliasEnabled(id, body.enabled !== false, configPath) });
      return;
    }
    if (req.method === "DELETE" && id) {
      if (url.searchParams.get("routeId")) {
        sendJson(res, 200, { data: await deleteModelRoute(url.searchParams.get("routeId"), configPath) });
        return;
      }
      sendJson(res, 200, { data: await deleteModelAlias(id, configPath) });
      return;
    }
  }

  if (resource === "export" && req.method === "GET") {
    sendJson(res, 200, await exportStore({
      includeProviderKeys: url.searchParams.get("includeProviderKeys") === "true",
      configPath
    }));
    return;
  }

  if (resource === "import" && req.method === "POST") {
    sendJson(res, 200, { data: await importStore(await readJson(req), configPath) });
    return;
  }

  sendJson(res, 404, { error: { message: "Admin endpoint not found" } });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

function sendJson(res, status, payload) {
  sendCors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendSse(res, events) {
  sendCors(res);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const event of events) {
    if (event.event) {
      res.write(`event: ${event.event}\n`);
    }
    res.write(`data: ${typeof event.data === "string" ? event.data : JSON.stringify(event.data)}\n\n`);
  }
  res.end();
}

export function configToOpenAiModels(config) {
  const aliases = (config.modelAliases || []).filter((alias) => alias.enabled);
  if (aliases.length > 0) {
    return {
      object: "list",
      data: aliases.map((alias) => ({
        id: alias.alias,
        object: "model",
        created: 0,
        owned_by: "aihub"
      }))
    };
  }

  const models = new Map();
  for (const subscription of config.subscriptions.filter((item) => item.enabled)) {
    for (const model of [subscription.model, ...(subscription.models || [])].filter(Boolean)) {
      if (!models.has(model)) {
        models.set(model, {
          id: model,
          object: "model",
          created: 0,
          owned_by: `aihub:${subscription.provider}`
        });
      }
    }
  }
  return {
    object: "list",
    data: [...models.values()]
  };
}

export function openAiChatToRouteRequest(body) {
  return {
    provider: body.provider,
    subscription: body.subscription,
    model: body.model,
    messages: body.messages,
    tools: body.tools,
    toolChoice: body.tool_choice,
    options: {
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      timeoutMs: body.timeout_ms
    }
  };
}

export function routeResultToOpenAiChat(result) {
  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.toolCalls?.length ? null : result.text,
          tool_calls: result.toolCalls?.length ? result.toolCalls : undefined
        },
        finish_reason: result.toolCalls?.length ? "tool_calls" : "stop"
      }
    ],
    aihub: {
      provider: result.provider,
      subscription: result.subscription,
      usage: result.usage,
      attempts: result.attempts
    }
  };
}

export function routeResultToOpenAiChatChunk(result) {
  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: result.toolCalls?.length ? undefined : result.text,
          tool_calls: result.toolCalls?.length ? result.toolCalls : undefined
        },
        finish_reason: null
      }
    ],
    aihub: {
      provider: result.provider,
      subscription: result.subscription,
      usage: result.usage
    }
  };
}

function sendOpenAiChatStream(res, result) {
  const doneChunk = {
    ...routeResultToOpenAiChatChunk({ ...result, text: "" }),
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: result.toolCalls?.length ? "tool_calls" : "stop"
      }
    ]
  };
  sendSse(res, [
    { data: routeResultToOpenAiChatChunk(result) },
    { data: doneChunk },
    { data: "[DONE]" }
  ]);
}

export function openAiResponseToRouteRequest(body) {
  return {
    provider: body.provider,
    subscription: body.subscription,
    model: body.model,
    prompt: typeof body.input === "string" ? body.input : undefined,
    messages: Array.isArray(body.input) ? body.input : undefined,
    tools: body.tools,
    toolChoice: body.tool_choice,
    options: {
      temperature: body.temperature,
      maxTokens: body.max_output_tokens,
      timeoutMs: body.timeout_ms
    }
  };
}

export function routeResultToOpenAiResponse(result) {
  return {
    id: `resp_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: result.model,
    output_text: result.text,
    output: result.toolCalls?.length ? result.toolCalls.map((call) => ({
      type: "function_call",
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments
    })) : [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: result.text
          }
        ]
      }
    ],
    aihub: {
      provider: result.provider,
      subscription: result.subscription,
      usage: result.usage,
      attempts: result.attempts
    }
  };
}

function sendOpenAiResponseStream(res, result) {
  const response = routeResultToOpenAiResponse(result);
  sendSse(res, [
    {
      event: "response.output_text.delta",
      data: {
        type: "response.output_text.delta",
        delta: result.text
      }
    },
    {
      event: "response.completed",
      data: {
        type: "response.completed",
        response
      }
    }
  ]);
}
