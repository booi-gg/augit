import { DEFAULT_CONFIG } from "./config.mjs";
import { generateCommitMessage } from "./generate.mjs";
import {
  commitStagedChanges,
  hasWorkingTreeChanges,
  stageAllChanges,
} from "./git.mjs";
import {
  formatChangesStatus,
  promptForGeneratedCommit,
  promptForNoStagedChanges,
} from "./interactive.mjs";
import { InvalidModelOutputError } from "./output.mjs";
import { createNodeLlamaRuntime } from "./runtime.mjs";

const noProgress = () => {};

noProgress.end = () => {};

export class CommitCommandUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CommitCommandUsageError";
    this.code = "INVALID_COMMIT_OPTION";
  }
}

export function parseCommitCommandArgs(args = []) {
  if (!Array.isArray(args)) {
    throw new TypeError("Commit command arguments must be an array.");
  }

  const separator = args.indexOf("--");
  const ownArgs = separator === -1 ? args : args.slice(0, separator);
  const gitArgs = separator === -1 ? [] : args.slice(separator + 1);
  let autoConfirm = false;
  let help = false;
  let stageEverything = false;

  for (const arg of ownArgs) {
    if (arg === "--all" || arg === "-a") {
      stageEverything = true;
    } else if (arg === "--yes" || arg === "-y") {
      autoConfirm = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      throw new CommitCommandUsageError(
        `Unknown commit option: ${arg}. Run gitkum commit --help.`,
      );
    }
  }

  return {
    autoConfirm,
    gitArgs,
    help,
    stageEverything,
  };
}

export async function runCommitWorkflow(
  {
    autoConfirm = false,
    gitArgs,
    requireCommit = false,
    stageEverything = false,
  } = {},
  io = process,
  {
    commitChanges = commitStagedChanges,
    config = DEFAULT_CONFIG,
    createRuntime = createNodeLlamaRuntime,
    cwd = process.cwd(),
    generate = generateCommitMessage,
    hasChanges = hasWorkingTreeChanges,
    modelProgress = noProgress,
    promptGeneratedCommit = promptForGeneratedCommit,
    promptNoStagedChanges = promptForNoStagedChanges,
    stageChanges = stageAllChanges,
  } = {},
) {
  if (gitArgs !== undefined) {
    validateGitArgs(gitArgs);
  }

  if (requireCommit && !autoConfirm && !supportsInteractiveReview(io)) {
    throw new Error(
      "gitkum commit needs an interactive terminal; pass --yes to accept the first generated message automatically.",
    );
  }

  if (stageEverything) {
    io.stderr.write(`${formatGitCommand(["add", "--all", "--"])}\n`);
    await stageChanges({ cwd });
  }

  let lastPhase;
  let runtime;
  let runtimeForUsage;
  let generatedMessage = false;

  try {
    runtime = await createRuntime();
    runtimeForUsage = runtime;

    const generationOptions = {
      cwd,
      onModelProgress: modelProgress,
      onStatus({ phase }) {
        if (phase === lastPhase) {
          return;
        }

        lastPhase = phase;

        if (phase === "collecting") {
          io.stderr.write("Collecting staged changes...\n");
        } else if (phase === "loading-model") {
          io.stderr.write(
            `${formatChangesStatus(true, { output: io.stderr })}\n`,
          );
          io.stderr.write("Loading local model...\n");
        } else if (phase === "generating") {
          modelProgress.end?.();
          io.stderr.write("Generating commit message...\n");
        }
      },
      runtime,
    };
    let message;
    let previousMessages = [];

    try {
      message = await generate(generationOptions);
      generatedMessage = true;
    } catch (error) {
      if (error?.code !== "NO_STAGED_CHANGES") {
        throw error;
      }

      const found = stageEverything ? false : await hasChanges({ cwd });

      io.stderr.write(`${formatChangesStatus(found, { output: io.stderr })}\n`);

      if (!found) {
        return 1;
      }

      const action = config.autoStageAll
        ? "stage"
        : await promptNoStagedChanges({
            input: io.stdin,
            output: io.stderr,
          });

      if (action === null) {
        io.stderr.write("Stage changes with git add, or pass --all.\n");
        return 1;
      }

      if (action !== "stage") {
        io.stderr.write(
          requireCommit
            ? "Cancelled; nothing was committed.\n"
            : "Cancelled.\n",
        );
        return 0;
      }

      io.stderr.write(
        requireCommit
          ? `${formatGitCommand(["add", "--all", "--"])}\n`
          : "Staging all changes...\n",
      );
      await stageChanges({ cwd });
      lastPhase = undefined;

      try {
        message = await generate(generationOptions);
        generatedMessage = true;
      } catch (retryError) {
        if (retryError?.code !== "NO_STAGED_CHANGES") {
          throw retryError;
        }

        io.stderr.write(
          `${formatChangesStatus(false, { output: io.stderr })}\n`,
        );
        return 1;
      }
    }

    while (true) {
      modelProgress.end?.();

      let action;

      if (requireCommit && autoConfirm) {
        io.stdout.write(`Generated commit message:\n\n${message}\n\n`);
        action = "commit";
      } else {
        action = await promptGeneratedCommit({
          input: io.stdin,
          message,
          output: io.stdout,
        });
      }

      if (action === null) {
        if (requireCommit) {
          throw new Error(
            "gitkum commit needs an interactive terminal; pass --yes to accept the first generated message automatically.",
          );
        }

        io.stdout.write(`${message}\n`);
        return 0;
      }

      if (action === "cancel") {
        io.stderr.write(
          requireCommit
            ? "\n- ABORT -; nothing was committed.\n"
            : "\n- ABORT -\n",
        );
        return 0;
      }

      if (action === "regenerate") {
        previousMessages = [...previousMessages, message].slice(-3);

        try {
          message = await generate({
            ...generationOptions,
            previousMessages,
          });
          generatedMessage = true;
        } catch (error) {
          if (!(error instanceof InvalidModelOutputError)) {
            throw error;
          }

          io.stderr.write(`${error.message} Keeping the previous message.\n`);
        }

        continue;
      }

      if (action === "commit") {
        const runtimeToDispose = runtime;

        runtime = undefined;
        await runtimeToDispose?.dispose?.();

        const commandArgs = ["commit", "--message", message];

        if (gitArgs !== undefined) {
          commandArgs.push(...gitArgs);
        }

        commandArgs.push("--");

        if (requireCommit) {
          io.stderr.write(`${formatGitCommand(commandArgs)}\n`);
        }

        const result = await commitChanges({
          cwd,
          message,
          ...(gitArgs === undefined ? {} : { args: gitArgs }),
        });

        if (result?.stderr) {
          io.stderr.write(result.stderr);
        }

        if (result?.stdout) {
          io.stdout.write(result.stdout);
        }

        return 0;
      }

      throw new TypeError(`Unsupported generated commit action: ${action}`);
    }
  } finally {
    let usage;

    if (generatedMessage) {
      try {
        usage = runtimeForUsage?.getUsage?.();
      } catch {
        // Diagnostics must never turn a successful generation into a failure.
      }
    }

    try {
      await runtime?.dispose?.();
    } finally {
      const summary = config.showUsageSummary
        ? formatGenerationUsage(usage)
        : "";

      if (summary) {
        io.stderr.write(summary);
      }
    }
  }
}

export function formatGitCommand(args) {
  return `$ ${["git", ...args].map(shellQuoteArg).join(" ")}`;
}

export function formatGenerationUsage(usage) {
  if (!Number.isFinite(usage?.tokens?.total)) {
    return "";
  }

  const lines = [
    "Generation usage",
    `  Tokens: ${formatInteger(usage.tokens.total)} total (${formatInteger(usage.tokens.input)} input, ${formatInteger(usage.tokens.output)} output)`,
  ];

  if (Number.isFinite(usage.wallTimeMs)) {
    lines.push(`  Wall time: ${formatDuration(usage.wallTimeMs)}`);
  }

  const cpuDetails = [];

  if (usage.cpu?.model) {
    cpuDetails.push(usage.cpu.model);
  }

  if (Number.isFinite(usage.cpu?.timeMs)) {
    cpuDetails.push(`${formatDuration(usage.cpu.timeMs)} time`);
  }

  if (Number.isFinite(usage.cpu?.memoryBytes)) {
    cpuDetails.push(`${formatBytes(usage.cpu.memoryBytes)} allocated`);
  }

  if (cpuDetails.length > 0) {
    lines.push(`  CPU: ${cpuDetails.join(", ")}`);
  }

  const backend = usage.gpu?.backend;

  if (backend === "cpu") {
    lines.push("  GPU: not used (CPU backend)");
  } else if (backend && backend !== "unknown") {
    const gpuDetails = [
      formatGpuBackend(backend),
      ...(usage.gpu.devices || []),
    ];

    if (Number.isFinite(usage.gpu.memoryBytes)) {
      gpuDetails.push(`${formatBytes(usage.gpu.memoryBytes)} allocated`);
    }

    lines.push(`  GPU: ${gpuDetails.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function shellQuoteArg(value) {
  return /^[\w./:=@-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'"'"'`)}'`;
}

function supportsInteractiveReview(io) {
  return Boolean(io.stdin?.isTTY && io.stdout?.isTTY && io.stderr?.isTTY);
}

function validateGitArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("Forwarded Git arguments must be an array of strings.");
  }
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

function formatDuration(milliseconds) {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)} ms`;
  }

  return `${(milliseconds / 1_000).toFixed(2)} s`;
}

function formatGpuBackend(backend) {
  return (
    {
      cuda: "CUDA",
      metal: "Metal",
      vulkan: "Vulkan",
    }[backend] || backend
  );
}

function formatInteger(value) {
  return Number.isFinite(value)
    ? Math.round(value).toLocaleString("en-US")
    : "0";
}
