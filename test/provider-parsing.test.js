import assert from "node:assert/strict";
import test from "node:test";
import { extractClaudeModels, extractClaudeText, extractClaudeUsage } from "../src/providers/claude.js";
import {
  contentToText,
  normalizeAnthropicConversation,
  normalizeCodexInput,
  normalizeGeminiConversation,
  normalizeMessages
} from "../src/providers/common.js";
import { extractCodexText, extractCodexUsage, extractOpenAiModels } from "../src/providers/codex.js";
import { extractGeminiModels, extractGeminiText, extractGeminiUsage } from "../src/providers/gemini.js";
import { extractOpenAiChatText, extractOpenAiChatToolCalls, extractOpenAiChatUsage } from "../src/providers/openai-compatible.js";
import {
  configToOpenAiModels,
  openAiChatToRouteRequest,
  routeResultToOpenAiChatChunk,
  routeResultToOpenAiChat,
  routeResultToOpenAiResponse
} from "../src/server.js";

test("extractCodexText supports output_text and content arrays", () => {
  assert.equal(extractCodexText({ output_text: "hello" }), "hello");
  assert.equal(
    extractCodexText({
      output: [{ content: [{ type: "output_text", text: "hello" }, { type: "output_text", text: "world" }] }]
    }),
    "hello\nworld"
  );
});

test("extractClaudeText and extractGeminiText collect text parts", () => {
  assert.equal(extractClaudeText({ content: [{ text: "a" }, { text: "b" }] }), "a\nb");
  assert.equal(
    extractGeminiText({
      candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }]
    }),
    "a\nb"
  );
});

test("provider usage extraction normalizes token and cache fields", () => {
  assert.deepEqual(
    extractCodexUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 30 },
        output_tokens_details: { reasoning_tokens: 5 }
      }
    }),
    {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 30,
      reasoningTokens: 5
    }
  );
  assert.deepEqual(
    extractOpenAiChatUsage({
      usage: {
        prompt_tokens: 70,
        completion_tokens: 11,
        total_tokens: 81,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 4 }
      }
    }),
    {
      inputTokens: 70,
      outputTokens: 11,
      totalTokens: 81,
      cachedInputTokens: 20,
      reasoningTokens: 4
    }
  );
  assert.deepEqual(
    extractClaudeUsage({
      usage: {
        input_tokens: 80,
        output_tokens: 10,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 12
      }
    }),
    {
      inputTokens: 80,
      outputTokens: 10,
      totalTokens: 90,
      cachedInputTokens: 40,
      cacheWriteTokens: 12
    }
  );
  assert.deepEqual(
    extractGeminiUsage({
      usageMetadata: {
        promptTokenCount: 90,
        candidatesTokenCount: 15,
        totalTokenCount: 105,
        cachedContentTokenCount: 45,
        thoughtsTokenCount: 6
      }
    }),
    {
      inputTokens: 90,
      outputTokens: 15,
      totalTokens: 105,
      cachedInputTokens: 45,
      reasoningTokens: 6
    }
  );
});

test("OpenAI-compatible chat parsing extracts text and tool calls", () => {
  const data = {
    choices: [
      { message: { content: "hello", tool_calls: [{ id: "call_1", type: "function", function: { name: "fn", arguments: "{}" } }] } },
      { message: { content: "world" } }
    ]
  };

  assert.equal(extractOpenAiChatText(data), "hello\nworld");
  assert.equal(extractOpenAiChatToolCalls(data)[0].function.name, "fn");
});

test("provider model list extraction normalizes model ids", () => {
  assert.deepEqual(extractOpenAiModels({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] }), ["gpt-a", "gpt-b"]);
  assert.deepEqual(extractClaudeModels({ data: [{ id: "claude-b" }, { id: "claude-a" }] }), ["claude-a", "claude-b"]);
  assert.deepEqual(
    extractGeminiModels({
      models: [
        { name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-embed", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-a" }
      ]
    }),
    ["gemini-a", "gemini-b"]
  );
});

test("OpenAI compatible mapping keeps model and messages", () => {
  const routeRequest = openAiChatToRouteRequest({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.2,
    max_tokens: 32
  });

  assert.equal(routeRequest.model, "test-model");
  assert.deepEqual(routeRequest.messages, [{ role: "user", content: "hi" }]);
  assert.equal(routeRequest.options.temperature, 0.2);
  assert.equal(routeRequest.options.maxTokens, 32);
});

test("message normalization supports content part arrays", () => {
  assert.equal(contentToText([{ type: "text", text: "hello" }, { type: "input_text", input_text: "world" }]), "hello\nworld");
  assert.deepEqual(normalizeMessages({ messages: [{ role: "developer", content: [{ text: "rules" }] }] }), [
    { role: "system", content: "rules" }
  ]);
});

test("tool calls and tool results are converted for providers", () => {
  const messages = [
    { role: "user", content: "weather?" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: "{\"city\":\"Shanghai\"}" }
        }
      ]
    },
    { role: "tool", tool_call_id: "call_1", name: "get_weather", content: "sunny" }
  ];

  assert.equal(normalizeCodexInput({ messages })[1].type, "function_call");
  assert.equal(normalizeCodexInput({ messages })[2].type, "function_call_output");

  const anthropic = normalizeAnthropicConversation({ messages });
  assert.equal(anthropic.messages[1].content[0].type, "tool_use");
  assert.equal(anthropic.messages[2].content[0].type, "tool_result");

  const gemini = normalizeGeminiConversation({ messages });
  assert.equal(gemini.contents[1].parts[0].functionCall.name, "get_weather");
  assert.equal(gemini.contents[2].parts[0].functionResponse.name, "get_weather");
});

test("OpenAI compatible responses include aihub routing metadata", () => {
  const result = {
    provider: "gemini",
    subscription: "main",
    model: "m",
    text: "ok",
    usage: { totalTokens: 3 },
    attempts: []
  };

  assert.equal(routeResultToOpenAiChat(result).choices[0].message.content, "ok");
  assert.equal(routeResultToOpenAiChat(result).aihub.usage.totalTokens, 3);
  assert.equal(routeResultToOpenAiChatChunk(result).choices[0].delta.content, "ok");
  assert.equal(routeResultToOpenAiResponse(result).output_text, "ok");
  assert.equal(routeResultToOpenAiResponse(result).aihub.usage.totalTokens, 3);
});

test("OpenAI model listing exposes enabled configured models once", () => {
  const list = configToOpenAiModels({
    subscriptions: [
      { enabled: true, provider: "gemini", model: "m1", models: ["m1", "m2"] },
      { enabled: true, provider: "claude", model: "m1", models: ["m3"] },
      { enabled: false, provider: "codex", model: "m2" }
    ]
  });

  assert.deepEqual(
    list.data.map((model) => model.id),
    ["m1", "m2", "m3"]
  );
});
