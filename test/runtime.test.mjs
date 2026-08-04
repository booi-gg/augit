import assert from "node:assert/strict";
import { test } from "node:test";

import { FILE_SUMMARY_SCHEMA } from "../src/summarize.mjs";
import {
  AgentApiError,
  AgentConfigurationError,
  createAgentRuntime,
  DEFAULT_AGENT_MODELS,
  ModelOutputTruncatedError,
  ModelRuntimeError,
  resolveAgentProvider,
} from "../src/runtime.mjs";

function jsonResponse(
  body,
  { ok = true, status = 200, statusText = "OK" } = {},
) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

test("resolves explicit providers and only detects unambiguous keys", () => {
  assert.equal(
    resolveAgentProvider({ apiKey: "anything", provider: "anthropic" }),
    "claude",
  );
  assert.equal(
    resolveAgentProvider({ apiKey: "anything", provider: "CODEX" }),
    "codex",
  );
  assert.equal(
    resolveAgentProvider({ apiKey: "sk-ant-fixture", provider: "auto" }),
    "claude",
  );
  assert.equal(
    resolveAgentProvider({ apiKey: "sk-proj-fixture", provider: "auto" }),
    "openai",
  );
  assert.throws(
    () => resolveAgentProvider({ apiKey: "sk-ambiguous", provider: "auto" }),
    (error) =>
      error instanceof AgentConfigurationError &&
      /Cannot safely determine/.test(error.message) &&
      /augit config set AGENT_PROVIDER openai/.test(error.message),
  );
});

test("requires an API key and a supported provider", () => {
  assert.throws(
    () => createAgentRuntime({ apiKey: "", provider: "openai" }),
    (error) =>
      error instanceof AgentConfigurationError &&
      error.code === "AGENT_CONFIGURATION_INVALID" &&
      /AGENT_API_KEY/.test(error.message) &&
      /augit config set AGENT_API_KEY/.test(error.message),
  );
  assert.throws(
    () => createAgentRuntime({ apiKey: "fixture", provider: "ollama" }),
    (error) =>
      /Unsupported AGENT_PROVIDER/.test(error.message) &&
      /augit config set AGENT_PROVIDER openai/.test(error.message),
  );
  assert.throws(
    () =>
      createAgentRuntime({
        apiKey: "fixture",
        model: "   ",
        provider: "openai",
      }),
    (error) =>
      /AGENT_MODEL/.test(error.message) &&
      /augit config set AGENT_MODEL ""/.test(error.message),
  );
});

test("calls OpenAI Responses with a strict schema and records usage", async () => {
  const calls = [];
  const times = [100, 125];
  const runtime = createAgentRuntime({
    apiKey: "sk-proj-fixture",
    fetch: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: '{"subject":"feat: call an API","body":""}',
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 800,
          output_tokens: 24,
          total_tokens: 824,
        },
      });
    },
    now: () => times.shift(),
    provider: "openai",
  });

  assert.deepEqual(await runtime.generate({ prompt: "Write JSON" }), {
    subject: "feat: call an API",
    body: "",
  });
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer sk-proj-fixture",
  );
  assert.equal(calls[0].body.model, DEFAULT_AGENT_MODELS.openai);
  assert.equal(calls[0].body.max_output_tokens, 1_024);
  assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
  assert.equal(calls[0].body.store, false);
  assert.deepEqual(calls[0].body.text.format, {
    name: "commit_message",
    schema: calls[0].body.text.format.schema,
    strict: true,
    type: "json_schema",
  });
  assert.deepEqual(runtime.getModelInfo(), {
    id: DEFAULT_AGENT_MODELS.openai,
    name: DEFAULT_AGENT_MODELS.openai,
    provider: "openai",
  });
  assert.deepEqual(runtime.getUsage(), {
    generations: 1,
    model: DEFAULT_AGENT_MODELS.openai,
    provider: "openai",
    tokens: { input: 800, output: 24, total: 824 },
    wallTimeMs: 25,
  });
});

test("uses the Codex model preset with an OpenAI API key", async () => {
  let request;
  const runtime = createAgentRuntime({
    apiKey: "fixture-key",
    fetch: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return jsonResponse({
        output_text: '{"subject":"fix: use codex","body":""}',
        status: "completed",
      });
    },
    provider: "codex",
  });

  await runtime.generate({ prompt: "Write JSON" });

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.model, DEFAULT_AGENT_MODELS.codex);
  assert.deepEqual(request.body.reasoning, { effort: "low" });
});

test("calls Claude Messages with its API headers and output schema", async () => {
  let request;
  const runtime = createAgentRuntime({
    apiKey: "sk-ant-fixture",
    fetch: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        content: [
          {
            type: "text",
            text: '{"summary":"Guard missing profiles"}',
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 120, output_tokens: 8 },
      });
    },
    provider: "auto",
  });

  assert.deepEqual(
    await runtime.generate({
      prompt: "Summarize as JSON",
      schema: FILE_SUMMARY_SCHEMA,
      temperature: 0.8,
    }),
    { summary: "Guard missing profiles" },
  );
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["x-api-key"], "sk-ant-fixture");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.model, DEFAULT_AGENT_MODELS.claude);
  assert.equal(request.body.temperature, 0.8);
  assert.deepEqual(request.body.output_config.format, {
    schema: FILE_SUMMARY_SCHEMA,
    type: "json_schema",
  });
});

test("calls DeepSeek Chat Completions without sharing its key elsewhere", async () => {
  let request;
  const runtime = createAgentRuntime({
    apiKey: "sk-ambiguous-fixture",
    fetch: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"subject":"feat: use deepseek","body":""}',
            },
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 12,
          total_tokens: 212,
        },
      });
    },
    provider: "deepseek",
  });

  await runtime.generate({ prompt: "Write JSON" });

  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(
    request.options.headers.Authorization,
    "Bearer sk-ambiguous-fixture",
  );
  assert.equal(request.body.model, DEFAULT_AGENT_MODELS.deepseek);
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.deepEqual(request.body.thinking, { type: "disabled" });
});

test("reports provider errors without exposing the API key", async () => {
  const apiKey = "sk-ant-super-secret";
  const runtime = createAgentRuntime({
    apiKey,
    fetch: async () =>
      jsonResponse(
        { error: { message: `authentication failed for ${apiKey}` } },
        { ok: false, status: 401, statusText: "Unauthorized" },
      ),
    provider: "claude",
  });

  await assert.rejects(runtime.generate({ prompt: "Write JSON" }), (error) => {
    assert.ok(error instanceof AgentApiError);
    assert.equal(error.status, 401);
    assert.match(error.message, /Claude API request failed \(401\)/);
    assert.match(error.message, /augit config set AGENT_PROVIDER claude/);
    assert.match(error.message, /augit config set AGENT_API_KEY/);
    assert.doesNotMatch(error.message, new RegExp(apiKey));
    return true;
  });
});

test("turns an unavailable model response into model setup instructions", async () => {
  const apiKey = "sk-proj-super-secret";
  const runtime = createAgentRuntime({
    apiKey,
    fetch: async () =>
      jsonResponse(
        {
          error: {
            code: "model_not_found",
            message: "The requested model does not exist or is unavailable.",
          },
        },
        { ok: false, status: 404, statusText: "Not Found" },
      ),
    model: "missing-model",
    provider: "openai",
  });

  await assert.rejects(runtime.generate({ prompt: "Write JSON" }), (error) => {
    assert.ok(error instanceof AgentApiError);
    assert.equal(error.status, 404);
    assert.match(error.message, /model may not exist/);
    assert.match(error.message, /augit config set AGENT_MODEL ""/);
    assert.doesNotMatch(error.message, new RegExp(apiKey));
    return true;
  });
});

test("turns provider length stops into retryable truncation errors", async () => {
  const runtime = createAgentRuntime({
    apiKey: "fixture",
    fetch: async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"subject":"fix: cut' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    provider: "deepseek",
  });

  await assert.rejects(
    runtime.generate({ prompt: "Write JSON" }),
    (error) => error instanceof ModelOutputTruncatedError,
  );
  assert.equal(runtime.getUsage().generations, 1);
});

test("returns malformed JSON as text for downstream repair", async () => {
  const runtime = createAgentRuntime({
    apiKey: "fixture",
    fetch: async () =>
      jsonResponse({
        choices: [{ finish_reason: "stop", message: { content: "not json" } }],
      }),
    provider: "deepseek",
  });

  assert.equal(await runtime.generate({ prompt: "Write JSON" }), "not json");
});

test("a disposed runtime rejects further generation", async () => {
  const runtime = createAgentRuntime({
    apiKey: "fixture",
    fetch: async () => jsonResponse({}),
    provider: "openai",
  });

  await runtime.dispose();

  await assert.rejects(
    runtime.generate({ prompt: "Write JSON" }),
    (error) =>
      error instanceof ModelRuntimeError && /disposed/.test(error.message),
  );
});
