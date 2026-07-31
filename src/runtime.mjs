import { availableParallelism, cpus } from "node:os";
import { performance } from "node:perf_hooks";

import { COMMIT_OUTPUT_SCHEMA } from "./prompt.mjs";

export const DEFAULT_CONTEXT_SIZE = 16 * 1024;
export const DEFAULT_MAX_TOKENS = 256;
const SYSTEM_PROMPT =
  "You are augi, a local tool that writes accurate Conventional Commit messages from staged Git evidence.";

export class ModelRuntimeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ModelRuntimeError";
    this.code = "MODEL_RUNTIME_FAILED";
  }
}

export class ModelOutputTruncatedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ModelOutputTruncatedError";
    this.code = "MODEL_OUTPUT_TRUNCATED";
  }
}

export function createNodeLlamaRuntime(options = {}) {
  return new NodeLlamaRuntime(options);
}

export async function inspectNodeLlamaRuntime({
  contextSize = DEFAULT_CONTEXT_SIZE,
  gpu = "auto",
  loadModule = () => import("node-llama-cpp"),
  logLevel = "error",
  maxTokens = DEFAULT_MAX_TOKENS,
} = {}) {
  const cpu = getHostCpuInfo();
  let llama;

  try {
    const { getLlama } = await loadModule();

    llama = await getLlama({ gpu, logLevel });

    const [devices, ram, vram] = await Promise.all([
      llama.getGpuDeviceNames(),
      llama.getRamState(),
      llama.getVramState(),
    ]);

    return {
      contextSize,
      maxTokens,
      cpu: {
        ...cpu,
        mathCores: llama.cpuMathCores,
        ramBytes: ram.total,
      },
      gpu: {
        backend: llama.gpu || "cpu",
        devices,
        memoryBytes: vram.total,
        unifiedMemory: vram.unifiedSize > 0,
      },
    };
  } catch (error) {
    return {
      contextSize,
      maxTokens,
      cpu,
      gpu: {
        backend: "unavailable",
        devices: [],
      },
      error: error?.message || String(error),
    };
  } finally {
    try {
      await llama?.dispose();
    } catch {
      // Runtime inspection is best-effort diagnostics.
    }
  }
}

class NodeLlamaRuntime {
  constructor({
    contextSize = DEFAULT_CONTEXT_SIZE,
    cpuUsage = (previousValue) => process.cpuUsage(previousValue),
    gpu = "auto",
    loadModule = () => import("node-llama-cpp"),
    logLevel = "error",
    maxTokens = DEFAULT_MAX_TOKENS,
    now = () => performance.now(),
  } = {}) {
    this.contextSize = contextSize;
    this.cpuUsage = cpuUsage;
    this.gpu = gpu;
    this.loadModule = loadModule;
    this.logLevel = logLevel;
    this.maxTokens = maxTokens;
    this.now = now;
    this.disposed = false;
    this.modulePromise = undefined;
    this.llamaPromise = undefined;
    this.modelPath = undefined;
    this.modelPromise = undefined;
    this.gpuDevices = undefined;
    this.usage = {
      cpu: getHostCpuInfo(),
      cpuMemoryBytes: 0,
      cpuMemoryMeasured: false,
      cpuSystemMicroseconds: 0,
      cpuUserMicroseconds: 0,
      generations: 0,
      gpuBackend: undefined,
      gpuMemoryBytes: 0,
      gpuMemoryMeasured: false,
      inputTokens: 0,
      outputTokens: 0,
      wallTimeMs: 0,
    };
  }

  async generate({
    maxTokens,
    modelPath,
    prompt,
    schema = COMMIT_OUTPUT_SCHEMA,
    seed,
    signal,
    temperature = 0,
  } = {}) {
    if (this.disposed) {
      throw new ModelRuntimeError("The local model runtime is disposed.");
    }

    if (!modelPath) {
      throw new ModelRuntimeError("A local model path is required.");
    }

    let context;
    let llama;
    let sequence;
    let session;
    const startedAt = this.now();
    const startedCpuUsage = this.cpuUsage();

    try {
      const [{ LlamaChatSession }, loadedLlama, model] = await Promise.all([
        this.getModule(),
        this.getLlama(),
        this.getModel(modelPath),
      ]);
      llama = loadedLlama;
      const grammar = await llama.createGrammarForJsonSchema(schema);

      context = await model.createContext({ contextSize: this.contextSize });
      sequence = context.getSequence();
      session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: SYSTEM_PROMPT,
      });

      const response = await session.prompt(prompt, {
        grammar,
        maxTokens: maxTokens || this.maxTokens,
        signal,
        temperature,
        ...(temperature > 0 && seed !== undefined ? { seed } : {}),
      });

      return grammar.parse(response);
    } catch (cause) {
      if (signal?.aborted && cause === signal.reason) {
        throw cause;
      }

      if (cause instanceof ModelRuntimeError) {
        throw cause;
      }

      if (cause instanceof SyntaxError) {
        throw new ModelOutputTruncatedError(
          "The model's response was cut off before it finished, most likely because it hit the output token limit.",
          { cause },
        );
      }

      throw new ModelRuntimeError(
        "Local model inference failed. Retry or run augi --download-model to verify the cache.",
        { cause },
      );
    } finally {
      await this.recordUsage({
        llama,
        sequence,
        startedAt,
        startedCpuUsage,
      }).catch(() => {});
      session?.dispose();
      await context?.dispose();
    }
  }

  getUsage() {
    if (this.usage.generations === 0) {
      return null;
    }

    const input = this.usage.inputTokens;
    const output = this.usage.outputTokens;

    return {
      generations: this.usage.generations,
      tokens: {
        input,
        output,
        total: input + output,
      },
      wallTimeMs: this.usage.wallTimeMs,
      cpu: {
        ...this.usage.cpu,
        timeMs:
          (this.usage.cpuUserMicroseconds + this.usage.cpuSystemMicroseconds) /
          1_000,
        ...(this.usage.cpuMemoryMeasured
          ? { memoryBytes: this.usage.cpuMemoryBytes }
          : {}),
      },
      gpu: {
        backend: this.usage.gpuBackend || "unknown",
        devices: [...(this.gpuDevices || [])],
        ...(this.usage.gpuMemoryMeasured
          ? { memoryBytes: this.usage.gpuMemoryBytes }
          : {}),
      },
    };
  }

  async dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.modelPromise) {
      const model = await this.modelPromise.catch(() => undefined);
      await model?.dispose();
    }

    if (this.llamaPromise) {
      const llama = await this.llamaPromise.catch(() => undefined);
      await llama?.dispose();
    }
  }

  getModule() {
    this.modulePromise ||= this.loadModule();
    return this.modulePromise;
  }

  getLlama() {
    this.llamaPromise ||= this.getModule().then(({ getLlama }) =>
      getLlama({ gpu: this.gpu, logLevel: this.logLevel }),
    );
    return this.llamaPromise;
  }

  getModel(modelPath) {
    if (this.modelPath && this.modelPath !== modelPath) {
      throw new ModelRuntimeError(
        "A runtime instance cannot load more than one built-in model.",
      );
    }

    this.modelPath = modelPath;
    this.modelPromise ||= this.getLlama().then((llama) =>
      llama.loadModel({ modelPath }),
    );
    return this.modelPromise;
  }

  async recordUsage({ llama, sequence, startedAt, startedCpuUsage }) {
    const elapsed = this.now() - startedAt;
    const cpu = this.cpuUsage(startedCpuUsage);
    const tokenState = sequence?.tokenMeter?.getState?.();
    let memory;

    if (llama?.getLlamaMemoryUsage) {
      memory = await llama.getLlamaMemoryUsage().catch(() => undefined);
    }

    if (llama) {
      this.usage.gpuBackend = llama.gpu || "cpu";
      this.usage.cpu = {
        ...this.usage.cpu,
        ...(Number.isFinite(llama.cpuMathCores)
          ? { mathCores: llama.cpuMathCores }
          : {}),
      };

      if (this.gpuDevices === undefined && llama.getGpuDeviceNames) {
        this.gpuDevices = await llama.getGpuDeviceNames().catch(() => []);
      }
    }

    this.usage.generations += 1;
    this.usage.inputTokens += finiteOrZero(tokenState?.usedInputTokens);
    this.usage.outputTokens += finiteOrZero(tokenState?.usedOutputTokens);
    this.usage.wallTimeMs += finiteOrZero(elapsed);
    this.usage.cpuUserMicroseconds += finiteOrZero(cpu?.user);
    this.usage.cpuSystemMicroseconds += finiteOrZero(cpu?.system);

    if (Number.isFinite(memory?.cpuRam)) {
      this.usage.cpuMemoryMeasured = true;
      this.usage.cpuMemoryBytes = Math.max(
        this.usage.cpuMemoryBytes,
        memory.cpuRam,
      );
    }

    if (Number.isFinite(memory?.gpuVram)) {
      this.usage.gpuMemoryMeasured = true;
      this.usage.gpuMemoryBytes = Math.max(
        this.usage.gpuMemoryBytes,
        memory.gpuVram,
      );
    }
  }
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function getHostCpuInfo() {
  const processors = cpus();

  return {
    model:
      processors.find(({ model }) => model.trim())?.model.trim() ||
      process.arch,
    logicalCores: processors.length || availableParallelism(),
  };
}
