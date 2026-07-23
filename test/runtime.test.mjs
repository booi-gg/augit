import assert from "node:assert/strict";
import { test } from "node:test";

import { createNodeLlamaRuntime } from "../src/runtime.mjs";

test("loads the model lazily and uses JSON grammar for inference", async () => {
  const calls = [];
  const grammar = {
    parse(value) {
      calls.push(["parse", value]);
      return JSON.parse(value);
    },
  };
  const context = {
    contextSize: 8192,
    getSequence() {
      return {};
    },
    async dispose() {
      calls.push(["dispose-context"]);
    },
  };
  const model = {
    async createContext(options) {
      calls.push(["create-context", options]);
      return context;
    },
    async dispose() {
      calls.push(["dispose-model"]);
    },
  };
  const llama = {
    async loadModel(options) {
      calls.push(["load-model", options]);
      return model;
    },
    async createGrammarForJsonSchema(schema) {
      calls.push(["grammar", schema]);
      return grammar;
    },
    async dispose() {
      calls.push(["dispose-llama"]);
    },
  };

  class FakeSession {
    constructor(options) {
      calls.push(["session", options]);
    }

    async prompt(prompt, options) {
      calls.push(["prompt", prompt, options]);
      return '{"subject":"feat: run locally","body":""}';
    }

    dispose() {
      calls.push(["dispose-session"]);
    }
  }

  const runtime = createNodeLlamaRuntime({
    loadModule: async () => ({
      getLlama: async (options) => {
        calls.push(["get-llama", options]);
        return llama;
      },
      LlamaChatSession: FakeSession,
    }),
  });

  const result = await runtime.generate({
    modelPath: "/cache/model.gguf",
    prompt: "Generate one message.",
  });
  await runtime.dispose();

  assert.deepEqual(result, {
    subject: "feat: run locally",
    body: "",
  });
  assert.equal(calls.filter(([name]) => name === "load-model").length, 1);
  assert.deepEqual(calls.find(([name]) => name === "get-llama")[1], {
    gpu: "auto",
    logLevel: "error",
  });
  assert.deepEqual(calls.find(([name]) => name === "create-context")[1], {
    contextSize: 16_384,
  });
  assert.equal(calls.find(([name]) => name === "prompt")[2].temperature, 0);
  assert.equal(calls.find(([name]) => name === "prompt")[2].maxTokens, 256);
  assert.ok(calls.some(([name]) => name === "dispose-context"));
  assert.ok(calls.some(([name]) => name === "dispose-model"));
  assert.ok(calls.some(([name]) => name === "dispose-llama"));
});
