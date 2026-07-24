import { readFile } from "node:fs/promises";

import { generateCommitMessage } from "./generate.mjs";
import {
  BUILT_IN_MODEL,
  clearBuiltInModel,
  ensureBuiltInModel,
  getBuiltInModelPath,
} from "./model.mjs";

const help = `gikum

Generate concise Git commit messages with a small local language model.

Usage:
  gikum [options]

Options:
      --clear-model     Delete the downloaded model from the cache
      --download-model  Download and verify the model for offline use
  -h, --help            Show help
  -v, --version         Show version

Run without options to generate a message from staged changes.
The built-in model is selected automatically; model selection is not exposed.
`;

export {
  BUILT_IN_MODEL,
  clearBuiltInModel,
  ensureBuiltInModel,
  getBuiltInModelPath,
};
export { extractKeyConcepts, inferRequiredType } from "./classify.mjs";
export {
  GitContextError,
  NoStagedChangesError,
  NotGitRepositoryError,
  collectStagedChanges,
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
    cwd = process.cwd(),
    ensureModel = ensureBuiltInModel,
    generate = generateCommitMessage,
  } = {},
) {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    const packageUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
    io.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (args.length === 1 && args[0] === "--download-model") {
    let lastProgress = -1;

    io.stderr.write(`Preparing ${BUILT_IN_MODEL.name}...\n`);

    try {
      const result = await ensureModel({
        onProgress: createProgressWriter(
          io,
          () => lastProgress,
          (value) => {
            lastProgress = value;
          },
        ),
      });
      const state = result.downloaded ? "downloaded" : "already cached";

      io.stdout.write(`Built-in model ready (${state}): ${result.path}\n`);
      return 0;
    } catch (error) {
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
        "gikum does not expose model selection; run gikum --help.\n",
    );
    return 2;
  }

  let lastProgress = -1;
  let lastPhase;

  try {
    const message = await generate({
      cwd,
      onModelProgress: createProgressWriter(
        io,
        () => lastProgress,
        (value) => {
          lastProgress = value;
        },
      ),
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
          io.stderr.write("Generating commit message...\n");
        }
      },
    });

    io.stdout.write(`${message}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error?.message || String(error)}\n`);
    return 1;
  }
}

function createProgressWriter(io, getLastProgress, setLastProgress) {
  return ({ downloaded, total }) => {
    if (!Number.isFinite(total) || total <= 0) {
      return;
    }

    const progress = Math.floor((downloaded / total) * 100);
    const milestone = Math.floor(progress / 5) * 5;

    if (milestone > getLastProgress() && milestone < 100) {
      setLastProgress(milestone);
      io.stderr.write(`Downloading built-in model: ${milestone}%\n`);
    }
  };
}
