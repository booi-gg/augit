import { COMMIT_OUTPUT_SCHEMA } from "./prompt.mjs";

const DEFAULT_CONTEXT_SIZE = 16 * 1024;
const DEFAULT_MAX_TOKENS = 256;
const SYSTEM_PROMPT =
  "You are gitkum, a local tool that writes accurate Conventional Commit messages from staged Git evidence.";

export class ModelRuntimeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ModelRuntimeError";
    this.code = "MODEL_RUNTIME_FAILED";
  }
}

export function createNodeLlamaRuntime(options = {}) {
  return new NodeLlamaRuntime(options);
}

class NodeLlamaRuntime {
  constructor({
    contextSize = DEFAULT_CONTEXT_SIZE,
    gpu = "auto",
    loadModule = () => import("node-llama-cpp"),
    logLevel = "error",
    maxTokens = DEFAULT_MAX_TOKENS,
  } = {}) {
    this.contextSize = contextSize;
    this.gpu = gpu;
    this.loadModule = loadModule;
    this.logLevel = logLevel;
    this.maxTokens = maxTokens;
    this.disposed = false;
    this.modulePromise = undefined;
    this.llamaPromise = undefined;
    this.modelPath = undefined;
    this.modelPromise = undefined;
  }

  async generate({ modelPath, prompt, signal } = {}) {
    if (this.disposed) {
      throw new ModelRuntimeError("The local model runtime is disposed.");
    }

    if (!modelPath) {
      throw new ModelRuntimeError("A local model path is required.");
    }

    let context;
    let session;

    try {
      const [{ LlamaChatSession }, llama, model] = await Promise.all([
        this.getModule(),
        this.getLlama(),
        this.getModel(modelPath),
      ]);
      const grammar =
        await llama.createGrammarForJsonSchema(COMMIT_OUTPUT_SCHEMA);

      context = await model.createContext({ contextSize: this.contextSize });
      session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: SYSTEM_PROMPT,
      });

      const response = await session.prompt(prompt, {
        grammar,
        maxTokens: this.maxTokens,
        signal,
        temperature: 0,
      });

      return grammar.parse(response);
    } catch (cause) {
      if (signal?.aborted && cause === signal.reason) {
        throw cause;
      }

      if (cause instanceof ModelRuntimeError) {
        throw cause;
      }

      throw new ModelRuntimeError(
        "Local model inference failed. Retry or run gitkum --download-model to verify the cache.",
        { cause },
      );
    } finally {
      session?.dispose();
      await context?.dispose();
    }
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
}
