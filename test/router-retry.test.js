import assert from "node:assert/strict";
import test from "node:test";
import { providers } from "../src/providers/index.js";
import { routeChat } from "../src/router.js";

test("routeChat retries a failing subscription before falling back by priority", async () => {
  const originalGemini = providers.gemini;
  const calls = [];
  providers.gemini = {
    async generate(subscription) {
      calls.push(subscription.name);
      if (subscription.name === "primary") {
        throw new Error("temporary upstream failure");
      }
      return {
        text: "ok",
        usage: { totalTokens: 1 }
      };
    }
  };

  try {
    const result = await routeChat({ prompt: "hi" }, {
      config: {
        routing: {
          fallback: true,
          requestTimeoutMs: 120000,
          retryAttempts: 2
        },
        logging: {
          enabled: false
        },
        subscriptions: [
          { name: "primary", provider: "gemini", apiKey: "a", model: "m", priority: 1, enabled: true },
          { name: "secondary", provider: "gemini", apiKey: "b", model: "m", priority: 2, enabled: true }
        ]
      }
    });

    assert.equal(result.subscription, "secondary");
    assert.deepEqual(calls, ["primary", "primary", "primary", "secondary"]);
    assert.equal(result.attempts.length, 4);
    assert.equal(result.attempts[0].maxRetries, 2);
    assert.equal(result.attempts[2].retry, 2);
    assert.equal(result.attempts[3].ok, true);
  } finally {
    providers.gemini = originalGemini;
  }
});

test("routeChat does not switch subscriptions when fallback is disabled", async () => {
  const originalGemini = providers.gemini;
  const calls = [];
  providers.gemini = {
    async generate(subscription) {
      calls.push(subscription.name);
      throw new Error("down");
    }
  };

  try {
    await assert.rejects(
      () => routeChat({ prompt: "hi" }, {
        config: {
          routing: {
            fallback: false,
            requestTimeoutMs: 120000,
            retryAttempts: 1
          },
          logging: {
            enabled: false
          },
          subscriptions: [
            { name: "primary", provider: "gemini", apiKey: "a", model: "m", priority: 1, enabled: true },
            { name: "secondary", provider: "gemini", apiKey: "b", model: "m", priority: 2, enabled: true }
          ]
        }
      }),
      /All matching subscriptions failed/
    );

    assert.deepEqual(calls, ["primary", "primary"]);
  } finally {
    providers.gemini = originalGemini;
  }
});
