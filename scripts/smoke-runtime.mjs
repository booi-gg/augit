import { loadConfig, resolveAgentConfig } from "../src/config.mjs";
import { createAgentRuntime } from "../src/runtime.mjs";

const runtime = createAgentRuntime(resolveAgentConfig(await loadConfig()));
const model = runtime.getModelInfo();

process.stdout.write(`Agent API configured (${model.provider}/${model.id})\n`);
await runtime.dispose();
