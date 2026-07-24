import { readFile } from "node:fs/promises";

import {
  CommitCommandUsageError,
  parseCommitCommandArgs,
  runCommitWorkflow,
} from "./commit.mjs";
import { generateCommitMessage } from "./generate.mjs";
import {
  commitStagedChanges,
  hasWorkingTreeChanges,
  stageAllChanges,
} from "./git.mjs";
import {
  promptForGeneratedCommit,
  promptForNoStagedChanges,
} from "./interactive.mjs";
import {
  BUILT_IN_MODEL,
  clearBuiltInModel,
  ensureBuiltInModel,
  getBuiltInModelInfo,
  getBuiltInModelPath,
} from "./model.mjs";
import {
  createNodeLlamaRuntime,
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_MAX_TOKENS,
  inspectNodeLlamaRuntime,
} from "./runtime.mjs";

const help = `gitkum

Generate concise Git commit messages with a small local language model.

Usage:
  gitkum [options]
  gitkum commit [options] [-- GIT_ARGS...]

Commands:
  commit                Draft, review, and commit staged changes

Options:
      --clear-model     Delete the downloaded model from the cache
      --download-model  Download and verify the model for offline use
      --model-info      Show information about the built-in model and its cache
  -h, --help            Show help
  -v, --version         Show version

Run gitkum commit --help for staging, automation, and Git passthrough options.
For compatibility, running without a command generates and reviews a message.
In non-interactive use, the bare command prints the message without committing.
The built-in model is selected automatically; model selection is not exposed.
`;

const commitHelp = `gitkum commit

Draft a Conventional Commit message from staged changes, review it, and commit.

Usage:
  gitkum commit [options] [-- GIT_ARGS...]

Options:
  -a, --all             Stage all changes with git add --all
  -y, --yes             Accept the first generated message without prompting
  -h, --help            Show commit command help

Arguments after -- are forwarded to git commit:
  gitkum commit -- --no-verify
  gitkum commit --all --yes -- --signoff
`;

export {
  BUILT_IN_MODEL,
  clearBuiltInModel,
  ensureBuiltInModel,
  getBuiltInModelInfo,
  getBuiltInModelPath,
};
export { extractKeyConcepts, inferRequiredType } from "./classify.mjs";
export {
  CommitCommandUsageError,
  formatGenerationUsage,
  formatGitCommand,
  parseCommitCommandArgs,
  runCommitWorkflow,
} from "./commit.mjs";
export {
  GitContextError,
  NoStagedChangesError,
  NotGitRepositoryError,
  collectStagedChanges,
  commitStagedChanges,
  hasWorkingTreeChanges,
  stageAllChanges,
} from "./git.mjs";
export { generateCommit, generateCommitMessage } from "./generate.mjs";
export { InvalidModelOutputError, normalizeCommitMessage } from "./output.mjs";
export {
  createNodeLlamaRuntime,
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_MAX_TOKENS,
  inspectNodeLlamaRuntime,
} from "./runtime.mjs";
export { sanitizeGitContext } from "./sanitize.mjs";

export async function run(
  args,
  io = process,
  {
    clearModel = clearBuiltInModel,
    commitChanges = commitStagedChanges,
    createRuntime = createNodeLlamaRuntime,
    cwd = process.cwd(),
    ensureModel = ensureBuiltInModel,
    generate = generateCommitMessage,
    getModelInfo = getBuiltInModelInfo,
    hasChanges = hasWorkingTreeChanges,
    inspectRuntime = inspectNodeLlamaRuntime,
    promptGeneratedCommit = promptForGeneratedCommit,
    promptNoStagedChanges = promptForNoStagedChanges,
    stageChanges = stageAllChanges,
  } = {},
) {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    const packageUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
    io.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (args.length === 1 && args[0] === "--model-info") {
    try {
      const [info, runtime] = await Promise.all([
        getModelInfo(),
        inspectRuntime(),
      ]);

      io.stdout.write(formatModelInfo(info, runtime));
      return 0;
    } catch (error) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
  }

  if (args.length === 1 && args[0] === "--download-model") {
    const modelProgress = createProgressWriter(io);

    io.stderr.write(`Preparing ${BUILT_IN_MODEL.name}...\n`);

    try {
      const result = await ensureModel({
        onProgress: modelProgress,
      });
      const state = result.downloaded ? "downloaded" : "already cached";

      modelProgress.end();
      io.stdout.write(`Built-in model ready (${state}): ${result.path}\n`);
      return 0;
    } catch (error) {
      modelProgress.end();
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
  }

  if (args.length === 1 && args[0] === "--clear-model") {
    try {
      const result = await clearModel();
      const state = result.cleared ? "cleared" : "is not cached";

      io.stdout.write(`Built-in model ${state}: ${result.path}\n`);
      return 0;
    } catch (error) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
  }

  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    io.stdout.write(help);
    return 0;
  }

  let commandOptions;

  if (args[0] === "commit") {
    try {
      commandOptions = {
        ...parseCommitCommandArgs(args.slice(1)),
        requireCommit: true,
      };
    } catch (error) {
      if (!(error instanceof CommitCommandUsageError)) {
        throw error;
      }

      io.stderr.write(`${error.message}\n`);
      return 2;
    }

    if (commandOptions.help) {
      io.stdout.write(commitHelp);
      return 0;
    }
  } else if (args.length === 0) {
    commandOptions = {};
  } else {
    io.stderr.write(
      `Unknown option: ${args.join(" ")}. ` +
        "gitkum does not expose model selection; run gitkum --help.\n",
    );
    return 2;
  }

  const modelProgress = createProgressWriter(io);

  try {
    return await runCommitWorkflow(commandOptions, io, {
      commitChanges,
      createRuntime,
      cwd,
      generate,
      hasChanges,
      modelProgress,
      promptGeneratedCommit,
      promptNoStagedChanges,
      stageChanges,
    });
  } catch (error) {
    modelProgress.end();
    io.stderr.write(`${error?.message || String(error)}\n`);
    return 1;
  }
}

function createProgressWriter(io) {
  const barWidth = 24;
  const isInteractive = Boolean(io.stderr?.isTTY);
  const milestoneSize = isInteractive ? 1 : 5;
  let lastLineLength = 0;
  let lastMilestone = -1;
  let lineOpen = false;

  const writeProgress = ({ downloaded, total }) => {
    if (!Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) {
      return;
    }

    const boundedDownloaded = Math.min(Math.max(downloaded, 0), total);
    const progress = Math.floor((boundedDownloaded / total) * 100);
    const milestone =
      progress === 100
        ? 100
        : Math.floor(progress / milestoneSize) * milestoneSize;

    if (milestone <= lastMilestone) {
      return;
    }

    lastMilestone = milestone;

    const filled = Math.round((milestone / 100) * barWidth);
    const bar = `${"#".repeat(filled)}${"-".repeat(barWidth - filled)}`;
    const line =
      `Downloading model [${bar}] ${String(milestone).padStart(3)}%  ` +
      `${formatBytes(boundedDownloaded)} / ${formatBytes(total)}`;

    if (!isInteractive) {
      io.stderr.write(`${line}\n`);
      return;
    }

    const padding = " ".repeat(Math.max(0, lastLineLength - line.length));

    io.stderr.write(`\r${line}${padding}`);
    lastLineLength = line.length;
    lineOpen = milestone < 100;

    if (!lineOpen) {
      io.stderr.write("\n");
      lastLineLength = 0;
    }
  };

  writeProgress.end = () => {
    if (lineOpen) {
      io.stderr.write("\n");
      lastLineLength = 0;
      lineOpen = false;
    }
  };

  return writeProgress;
}

function formatBytes(bytes) {
  if (bytes < 1_000) {
    return `${Math.floor(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1_000)) - 1,
    units.length - 1,
  );
  const value = bytes / 1_000 ** (unitIndex + 1);
  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatModelInfo({ file, model, path, state }, runtime) {
  const status = {
    invalid: "downloaded but failed verification",
    missing: "not downloaded",
    ready: "downloaded and verified",
  }[state];
  const lines = [
    "Built-in model",
    `  Name: ${model.name}`,
    `  ID: ${model.id}`,
    `  Parameters: ${formatCompactCount(model.parameterCount)} (${model.parameterCount.toLocaleString("en-US")})`,
    `  Quantization: ${model.quantization}`,
    `  Vocabulary: ${model.vocabularySize.toLocaleString("en-US")} tokens`,
    `  Context: ${model.contextSize.toLocaleString("en-US")} tokens (${runtime.contextSize.toLocaleString("en-US")} used by gitkum)`,
    `  Output limit: ${runtime.maxTokens.toLocaleString("en-US")} tokens`,
    `  Status: ${status || state}`,
    `  Path: ${path}`,
    `  Size: ${formatBytes(model.byteLength)} (${model.byteLength.toLocaleString("en-US")} bytes)`,
  ];

  if (file && file.byteLength !== model.byteLength) {
    lines.push(
      `  Cached size: ${formatBytes(file.byteLength)} (${file.byteLength.toLocaleString("en-US")} bytes)`,
    );
  }

  lines.push(`  SHA-256: ${model.sha256}`, `  Source: ${model.url}`);
  lines.push(
    "Runtime",
    `  CPU: ${formatCpuInfo(runtime.cpu)}`,
    `  GPU: ${formatGpuInfo(runtime.gpu)}`,
  );

  if (runtime.error) {
    lines.push(
      `  Probe: unavailable (${String(runtime.error).replace(/\s+/g, " ").trim()})`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatCompactCount(value) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  return value.toLocaleString("en-US");
}

function formatCpuInfo(cpu = {}) {
  const details = [];

  if (Number.isFinite(cpu.mathCores)) {
    details.push(`${cpu.mathCores} math cores`);
  }

  if (Number.isFinite(cpu.logicalCores)) {
    details.push(`${cpu.logicalCores} logical cores`);
  }

  if (Number.isFinite(cpu.ramBytes)) {
    details.push(`${formatBytes(cpu.ramBytes)} RAM`);
  }

  return `${cpu.model || process.arch}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function formatGpuInfo(gpu = {}) {
  if (gpu.backend === "cpu") {
    return "not used (CPU backend)";
  }

  if (gpu.backend === "unavailable") {
    return "unavailable";
  }

  const backend =
    {
      cuda: "CUDA",
      metal: "Metal",
      vulkan: "Vulkan",
    }[gpu.backend] || gpu.backend;
  const details = [...(gpu.devices || [])];

  if (Number.isFinite(gpu.memoryBytes)) {
    const memoryType = gpu.unifiedMemory ? "unified memory" : "memory";

    details.push(`${formatBytes(gpu.memoryBytes)} ${memoryType}`);
  }

  return `${backend || "unknown"}${details.length ? ` (${details.join(", ")})` : ""}`;
}
