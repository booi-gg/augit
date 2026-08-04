import { readFile } from "node:fs/promises";

import {
  CommitCommandUsageError,
  parseCommitCommandArgs,
  runCommitWorkflow,
} from "./commit.mjs";
import {
  ConfigCommandUsageError,
  loadConfig as loadConfigFile,
  runConfigCommand,
  saveConfig as saveConfigFile,
} from "./config.mjs";
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
import { clearLegacyModel } from "./model-cache.mjs";
import { createAgentRuntime } from "./runtime.mjs";

const help = `augi

Generate concise Git commit messages with a configured agent API.

Usage:
  augi [options]
  augi commit [options] [-- GIT_ARGS...]

Commands:
  commit                Draft, review, and commit staged changes
  config                Get or set persisted configuration

Options:
      --clear-model     Delete the model downloaded by earlier Augi versions
  -h, --help            Show help
  -v, --version         Show version

Run augi commit --help for staging, automation, and Git passthrough options.
Run augi config --help for the list of configurable keys.
Running augi with no arguments prints this help.
`;

const commitHelp = `augi commit

Draft a Conventional Commit message from staged changes, review it, and commit.

Usage:
  augi commit [options] [-- GIT_ARGS...]

Options:
  -a, --all             Stage all changes with git add --all
  -y, --yes             Accept the first generated message without prompting
  -h, --help            Show commit command help

Arguments after -- are forwarded to git commit:
  augi commit -- --no-verify
  augi commit --all --yes -- --signoff
`;

export { extractKeyConcepts, inferRequiredType } from "./classify.mjs";
export {
  CommitCommandUsageError,
  formatGenerationUsage,
  formatGitCommand,
  parseCommitCommandArgs,
  runCommitWorkflow,
} from "./commit.mjs";
export {
  ConfigCommandUsageError,
  DEFAULT_CONFIG,
  getConfigDirectory,
  getConfigFilePath,
  loadConfig,
  resolveAgentConfig,
  runConfigCommand,
  saveConfig,
} from "./config.mjs";
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
  AgentApiError,
  AgentConfigurationError,
  createAgentRuntime,
  DEFAULT_AGENT_MODELS,
  DEFAULT_MAX_TOKENS,
  ModelOutputTruncatedError,
  ModelRuntimeError,
  resolveAgentProvider,
} from "./runtime.mjs";
export { sanitizeGitContext } from "./sanitize.mjs";

export async function run(
  args,
  io = process,
  {
    clearModel = clearLegacyModel,
    commitChanges = commitStagedChanges,
    createRuntime = createAgentRuntime,
    cwd = process.cwd(),
    generate = generateCommitMessage,
    hasChanges = hasWorkingTreeChanges,
    loadConfig = loadConfigFile,
    promptGeneratedCommit = promptForGeneratedCommit,
    promptNoStagedChanges = promptForNoStagedChanges,
    saveConfig = saveConfigFile,
    stageChanges = stageAllChanges,
  } = {},
) {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    const packageUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
    io.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (args.length === 1 && args[0] === "--clear-model") {
    try {
      const result = await clearModel();
      const state = result.cleared ? "cleared" : "is not cached";

      io.stdout.write(`Built-in model ${state}: ${result.path}\n`);
      return 0;
    } catch (error) {
      io.stderr.write(`${error?.message || String(error)}\n`);
      return 1;
    }
  }

  if (
    args.length === 0 ||
    (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
  ) {
    io.stdout.write(help);
    return 0;
  }

  if (args[0] === "config") {
    try {
      return await runConfigCommand(args.slice(1), io, {
        load: loadConfig,
        save: saveConfig,
      });
    } catch (error) {
      if (!(error instanceof ConfigCommandUsageError)) {
        throw error;
      }

      io.stderr.write(`${error.message}\n`);
      return 2;
    }
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
  } else {
    io.stderr.write(`Unknown option: ${args.join(" ")}. Run augi --help.\n`);
    return 2;
  }

  try {
    const config = await loadConfig();

    return await runCommitWorkflow(commandOptions, io, {
      commitChanges,
      config,
      createRuntime,
      cwd,
      generate,
      hasChanges,
      promptGeneratedCommit,
      promptNoStagedChanges,
      stageChanges,
    });
  } catch (error) {
    io.stderr.write(`${error?.message || String(error)}\n`);
    return 1;
  }
}
