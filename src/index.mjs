import { readFile } from "node:fs/promises";

import { generateCommitMessage } from "./generate.mjs";
import { commitStagedChanges, stageAllChanges } from "./git.mjs";
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
import { createNodeLlamaRuntime } from "./runtime.mjs";

const help = `gitkum

Generate concise Git commit messages with a small local language model.

Usage:
  gitkum [options]

Options:
      --clear-model     Delete the downloaded model from the cache
      --download-model  Download and verify the model for offline use
      --model-info      Show information about the built-in model and its cache
  -h, --help            Show help
  -v, --version         Show version

Run without options to generate and review a message from staged changes.
In an interactive terminal, choose whether to commit, generate again, or cancel.
If none are staged in an interactive terminal, gitkum can stage all changes.
In non-interactive use, the generated message is printed without committing.
The built-in model is selected automatically; model selection is not exposed.
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
  GitContextError,
  NoStagedChangesError,
  NotGitRepositoryError,
  collectStagedChanges,
  commitStagedChanges,
  stageAllChanges,
} from "./git.mjs";
export { generateCommit, generateCommitMessage } from "./generate.mjs";
export { InvalidModelOutputError, normalizeCommitMessage } from "./output.mjs";
export { createNodeLlamaRuntime } from "./runtime.mjs";
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
      const info = await getModelInfo();

      io.stdout.write(formatModelInfo(info));
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

  if (args.length > 0) {
    io.stderr.write(
      `Unknown option: ${args.join(" ")}. ` +
        "gitkum does not expose model selection; run gitkum --help.\n",
    );
    return 2;
  }

  let lastPhase;
  const modelProgress = createProgressWriter(io);

  try {
    let runtime;
    try {
      runtime = await createRuntime();
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
            io.stderr.write("Loading local model...\n");
          } else if (phase === "generating") {
            modelProgress.end();
            io.stderr.write("Generating commit message...\n");
          }
        },
        runtime,
      };
      let message;
      let previousMessages = [];

      try {
        message = await generate(generationOptions);
      } catch (error) {
        if (error?.code !== "NO_STAGED_CHANGES") {
          throw error;
        }

        const action = await promptNoStagedChanges({
          input: io.stdin,
          output: io.stderr,
        });

        if (action === null) {
          throw error;
        }

        if (action !== "stage") {
          io.stderr.write("Cancelled.\n");
          return 0;
        }

        io.stderr.write("Staging all changes...\n");
        await stageChanges({ cwd });
        lastPhase = undefined;
        message = await generate(generationOptions);
      }

      while (true) {
        modelProgress.end();

        const action = await promptGeneratedCommit({
          input: io.stdin,
          message,
          output: io.stdout,
        });

        if (action === null) {
          io.stdout.write(`${message}\n`);
          return 0;
        }

        if (action === "cancel") {
          io.stderr.write("Cancelled.\n");
          return 0;
        }

        if (action === "regenerate") {
          previousMessages = [...previousMessages, message].slice(-3);
          message = await generate({
            ...generationOptions,
            previousMessages,
          });
          continue;
        }

        if (action === "commit") {
          const runtimeToDispose = runtime;

          runtime = undefined;
          await runtimeToDispose?.dispose?.();

          const result = await commitChanges({ cwd, message });

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
      await runtime?.dispose?.();
    }
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

function formatModelInfo({ file, model, path, state }) {
  const status = {
    invalid: "downloaded but failed verification",
    missing: "not downloaded",
    ready: "downloaded and verified",
  }[state];
  const lines = [
    "Built-in model",
    `  Name: ${model.name}`,
    `  ID: ${model.id}`,
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

  return `${lines.join("\n")}\n`;
}
