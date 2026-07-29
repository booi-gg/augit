import { DEFAULT_CONFIG } from "./config.mjs";
import { generateCommitMessage } from "./generate.mjs";
import {
  commitStagedChanges,
  hasWorkingTreeChanges,
  stageAllChanges,
} from "./git.mjs";
import {
  formatAccentText,
  formatChangesStatus,
  formatMutedText,
  formatStatusText,
  formatUnstagedNotice,
  promptForGeneratedCommit,
  promptForNoStagedChanges,
} from "./interactive.mjs";
import { InvalidModelOutputError } from "./output.mjs";
import { createNodeLlamaRuntime } from "./runtime.mjs";

const noProgress = () => {};

noProgress.end = () => {};

const SPINNER_FRAMES = ["|", "/", "-", "\\"];
const SPINNER_INTERVAL_MS = 100;
const MAX_GENERATION_ATTEMPTS = 3;

async function generateWithRetries(generate, generationOptions, io) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await generate(generationOptions);
    } catch (error) {
      if (
        !(error instanceof InvalidModelOutputError) ||
        attempt >= MAX_GENERATION_ATTEMPTS
      ) {
        throw error;
      }

      io.stderr.write(`${error.message} Retrying...\n`);
    }
  }
}

function createStatusSpinner(io) {
  const isInteractive = Boolean(io.stderr?.isTTY);
  let timer;
  let label = "";
  let accent = false;
  let frameIndex = 0;

  function render() {
    const line = `${SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]} ${label}`;

    io.stderr.write(
      `\r${accent ? formatAccentText(line, { output: io.stderr }) : line}`,
    );
    frameIndex += 1;
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = undefined;
    io.stderr.write(`\r${" ".repeat(label.length + 2)}\r`);
  }

  return {
    start(text, { accent: useAccent = false } = {}) {
      stop();
      accent = useAccent;

      if (!isInteractive) {
        io.stderr.write(
          `${useAccent ? formatAccentText(text, { output: io.stderr }) : text}\n`,
        );
        return;
      }

      label = text;
      frameIndex = 0;
      render();
      timer = setInterval(render, SPINNER_INTERVAL_MS);
      timer.unref?.();
    },
    stop,
  };
}

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
        `Unknown commit option: ${arg}. Run augi commit --help.`,
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
      "augi commit needs an interactive terminal; pass --yes to accept the first generated message automatically.",
    );
  }

  if (stageEverything) {
    io.stderr.write(
      `\n${formatMutedText(formatGitCommand(["add", "--all", "--"]), { output: io.stderr })}\n\n`,
    );
    await stageChanges({ cwd });
  }

  let lastPhase;
  let runtime;
  let runtimeForUsage;
  let generatedMessage = false;
  let suppressStatusAnnouncements = false;
  const spinner = createStatusSpinner(io);

  try {
    runtime = await createRuntime();
    runtimeForUsage = runtime;

    const generationOptions = {
      allowScope: config["show-scope"],
      cwd,
      onModelProgress: modelProgress,
      onStatus({ phase }) {
        if (phase === lastPhase) {
          return;
        }

        lastPhase = phase;

        if (phase === "collecting") {
          if (!suppressStatusAnnouncements) {
            io.stderr.write("Checking staged changes...\n");
          }
        } else if (phase === "loading-model") {
          if (!suppressStatusAnnouncements) {
            io.stderr.write(
              `${formatChangesStatus(true, { output: io.stderr })}\n`,
            );
          }

          spinner.start("Loading local model: ");
        } else if (phase === "generating") {
          modelProgress.end?.();
          spinner.start("Generating commit message", { accent: true });
        }
      },
      runtime,
    };
    let message;
    let previousMessages = [];

    try {
      message = await generateWithRetries(generate, generationOptions, io);
      generatedMessage = true;
    } catch (error) {
      if (error?.code !== "NO_STAGED_CHANGES") {
        throw error;
      }

      io.stderr.write(`${formatChangesStatus(false, { output: io.stderr })}\n`);

      let found = false;

      if (!stageEverything) {
        io.stderr.write("Checking unstaged changes...\n");
        found = await hasChanges({ cwd });
        io.stderr.write(
          `${formatChangesStatus(found, { output: io.stderr })}\n`,
        );
      }

      if (!found) {
        return 1;
      }

      const action = config["auto-stage-all"]
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
          ? `\n${formatMutedText(formatGitCommand(["add", "--all", "--"]), { output: io.stderr })}\n\n`
          : "Staging all changes...\n",
      );
      await stageChanges({ cwd });
      lastPhase = undefined;
      suppressStatusAnnouncements = true;

      try {
        message = await generateWithRetries(generate, generationOptions, io);
        generatedMessage = true;
      } catch (retryError) {
        if (retryError?.code !== "NO_STAGED_CHANGES") {
          throw retryError;
        }

        io.stderr.write(
          `${formatChangesStatus(false, { output: io.stderr })}\n`,
        );
        return 1;
      } finally {
        suppressStatusAnnouncements = false;
      }
    }

    while (true) {
      modelProgress.end?.();
      spinner.stop();

      let action;

      if (requireCommit && autoConfirm) {
        io.stdout.write(`Generated commit message:\n\n${message}\n\n\n`);
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
            "augi commit needs an interactive terminal; pass --yes to accept the first generated message automatically.",
          );
        }

        io.stdout.write(`${message}\n`);
        return 0;
      }

      if (action === "cancel") {
        io.stderr.write(
          requireCommit
            ? "\n// ABORT //: nothing was committed.\n"
            : "\n// ABORT //\n",
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
          io.stderr.write(
            `\n${formatMutedText(formatGitCommand(commandArgs), { output: io.stderr })}\n\n`,
          );
        }

        await commitChanges({
          cwd,
          message,
          ...(gitArgs === undefined ? {} : { args: gitArgs }),
        });

        io.stderr.write(
          `\n${formatStatusText("Committed successfully.", { output: io.stderr })}\n`,
        );

        try {
          if (await hasChanges({ cwd })) {
            io.stderr.write(
              `\n${formatUnstagedNotice({ output: io.stderr })}\n`,
            );
          }
        } catch {
          // Best-effort notice; a successful commit must never be reported as failed.
        }

        return 0;
      }

      throw new TypeError(`Unsupported generated commit action: ${action}`);
    }
  } finally {
    spinner.stop();

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
      const summary = config["show-usage-summary"]
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
