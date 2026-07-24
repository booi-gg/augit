import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createNodeLlamaRuntime,
  inspectNodeLlamaRuntime,
} from "../src/runtime.mjs";

test("loads the model lazily and uses JSON grammar for inference", async () => {
  const calls = [];
  const grammar = {
    parse(value) {
      calls.push(["parse", value]);
      return JSON.parse(value);
    },
  };
  const sequence = {
    tokenMeter: {
      getState() {
        return {
          usedInputTokens: 1_024,
          usedOutputTokens: 24,
        };
      },
    },
  };
  const context = {
    contextSize: 8192,
    getSequence() {
      return sequence;
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
    cpuMathCores: 6,
    gpu: "metal",
    async loadModel(options) {
      calls.push(["load-model", options]);
      return model;
    },
    async createGrammarForJsonSchema(schema) {
      calls.push(["grammar", schema]);
      return grammar;
    },
    async getGpuDeviceNames() {
      return ["Fixture GPU"];
    },
    async getLlamaMemoryUsage() {
      return {
        cpuRam: 250_000_000,
        gpuVram: 1_100_000_000,
      };
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
    cpuUsage(previousValue) {
      return previousValue
        ? { user: 300_000, system: 50_000 }
        : { user: 0, system: 0 };
    },
    now: (() => {
      const values = [100, 2_600, 3_000, 4_000];

      return () => values.shift();
    })(),
  });

  const result = await runtime.generate({
    modelPath: "/cache/model.gguf",
    prompt: "Generate one message.",
  });
  await runtime.generate({
    modelPath: "/cache/model.gguf",
    prompt: "Generate another message.",
  });
  const usage = runtime.getUsage();
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
  assert.deepEqual(usage, {
    generations: 2,
    tokens: {
      input: 2_048,
      output: 48,
      total: 2_096,
    },
    wallTimeMs: 3_500,
    cpu: {
      model: usage.cpu.model,
      logicalCores: usage.cpu.logicalCores,
      mathCores: 6,
      timeMs: 700,
      memoryBytes: 250_000_000,
    },
    gpu: {
      backend: "metal",
      devices: ["Fixture GPU"],
      memoryBytes: 1_100_000_000,
    },
  });
});

test("inspects CPU, GPU, and token limits without loading model weights", async () => {
  const calls = [];
  const llama = {
    cpuMathCores: 8,
    gpu: "metal",
    async dispose() {
      calls.push("dispose");
    },
    async getGpuDeviceNames() {
      return ["Fixture GPU"];
    },
    async getRamState() {
      return { total: 32_000_000_000 };
    },
    async getVramState() {
      return {
        total: 20_000_000_000,
        unifiedSize: 20_000_000_000,
      };
    },
  };

  const info = await inspectNodeLlamaRuntime({
    loadModule: async () => ({
      async getLlama(options) {
        calls.push(options);
        return llama;
      },
    }),
  });

  assert.equal(info.contextSize, 16_384);
  assert.equal(info.maxTokens, 256);
  assert.equal(info.cpu.mathCores, 8);
  assert.equal(info.cpu.ramBytes, 32_000_000_000);
  assert.equal(info.gpu.backend, "metal");
  assert.deepEqual(info.gpu.devices, ["Fixture GPU"]);
  assert.equal(info.gpu.memoryBytes, 20_000_000_000);
  assert.equal(info.gpu.unifiedMemory, true);
  assert.deepEqual(calls[0], { gpu: "auto", logLevel: "error" });
  assert.equal(calls.at(-1), "dispose");
});

test("keeps host information when the GPU probe is unavailable", async () => {
  const info = await inspectNodeLlamaRuntime({
    loadModule: async () => ({
      async getLlama() {
        return {
          async dispose() {
            throw new Error("dispose failed");
          },
          async getGpuDeviceNames() {
            throw new Error("GPU probe failed");
          },
          async getRamState() {
            return { total: 1 };
          },
          async getVramState() {
            return { total: 1, unifiedSize: 0 };
          },
        };
      },
    }),
  });

  assert.match(info.cpu.model, /\S/);
  assert.equal(info.gpu.backend, "unavailable");
  assert.equal(info.error, "GPU probe failed");
});
