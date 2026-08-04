import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CommitCommandUsageError,
  formatGenerationUsage,
  formatGitCommand,
  parseCommitCommandArgs,
  runCommitWorkflow,
} from "../src/commit.mjs";

function workflowIo() {
  const state = { stderr: "", stdout: "" };
  const io = {
    stdin: { isTTY: false },
    stdout: {
      isTTY: false,
      write(value) {
        state.stdout += value;
      },
    },
    stderr: {
      isTTY: false,
      write(value) {
        state.stderr += value;
      },
    },
  };

  return { io, state };
}

test("parses commit wrapper options and Git passthrough arguments", () => {
  assert.deepEqual(
    parseCommitCommandArgs(["--all", "-y", "--", "--no-verify", "--signoff"]),
    {
      autoConfirm: true,
      gitArgs: ["--no-verify", "--signoff"],
      help: false,
      stageEverything: true,
    },
  );
});

test("does not treat Git passthrough arguments as wrapper options", () => {
  assert.deepEqual(parseCommitCommandArgs(["--", "--all", "--yes"]), {
    autoConfirm: false,
    gitArgs: ["--all", "--yes"],
    help: false,
    stageEverything: false,
  });
});

test("rejects unsupported commit wrapper options", () => {
  assert.throws(
    () => parseCommitCommandArgs(["--amend"]),
    (error) =>
      error instanceof CommitCommandUsageError &&
      error.code === "INVALID_COMMIT_OPTION",
  );
});

test("formats copy-pasteable Git commands", () => {
  assert.equal(
    formatGitCommand([
      "commit",
      "--message",
      "fix(cli): don't hide failures",
      "--no-verify",
      "--",
    ]),
    `$ git commit --message 'fix(cli): don'"'"'t hide failures' --no-verify --`,
  );
});

test("formats remote agent generation usage", () => {
  assert.equal(
    formatGenerationUsage({
      model: "deepseek-v4-flash",
      provider: "deepseek",
      tokens: {
        input: 800,
        output: 24,
        total: 824,
      },
      wallTimeMs: 900,
    }),
    [
      "Generation usage",
      "  Agent: DeepSeek (deepseek-v4-flash)",
      "  Tokens: 824 total (800 input, 24 output)",
      "  Wall time: 900 ms",
      "",
    ].join("\n"),
  );
});

test("runs an API-backed auto-confirmed commit and forwards agent config", async () => {
  const { io, state } = workflowIo();
  const calls = [];
  const runtime = {
    async dispose() {
      calls.push(["dispose"]);
    },
    getUsage() {
      return {
        model: "deepseek-v4-flash",
        provider: "deepseek",
        tokens: { input: 100, output: 10, total: 110 },
        wallTimeMs: 25,
      };
    },
  };
  const config = {
    AGENT_API_KEY: "fixture-key",
    AGENT_MODEL: "deepseek-chat",
    AGENT_PROVIDER: "deepseek",
    "auto-stage-all": false,
    "show-scope": false,
    "show-usage-summary": true,
  };

  const status = await runCommitWorkflow(
    {
      autoConfirm: true,
      gitArgs: ["--signoff"],
      requireCommit: true,
      stageEverything: true,
    },
    io,
    {
      async commitChanges(options) {
        calls.push(["commit", options]);
      },
      config,
      async createRuntime(options) {
        calls.push(["runtime", options]);
        return runtime;
      },
      cwd: "/repo",
      async generate(options) {
        calls.push(["generate", options]);
        options.onStatus({ phase: "collecting" });
        options.onStatus({ phase: "preparing-agent" });
        options.onStatus({ phase: "generating" });
        return "feat: call the agent API";
      },
      async hasChanges() {
        return true;
      },
      resolveConfig(value) {
        return {
          apiKey: value.AGENT_API_KEY,
          model: value.AGENT_MODEL,
          provider: value.AGENT_PROVIDER,
        };
      },
      async stageChanges(options) {
        calls.push(["stage", options]);
      },
    },
  );

  assert.equal(status, 0);
  assert.deepEqual(calls[0], ["stage", { cwd: "/repo" }]);
  assert.deepEqual(calls[1], [
    "runtime",
    {
      apiKey: "fixture-key",
      model: "deepseek-chat",
      provider: "deepseek",
    },
  ]);
  assert.equal(calls[2][1].allowScope, false);
  assert.equal(calls[2][1].runtime, runtime);
  assert.deepEqual(calls[3], ["dispose"]);
  assert.deepEqual(calls[4], [
    "commit",
    {
      args: ["--signoff"],
      cwd: "/repo",
      message: "feat: call the agent API",
    },
  ]);
  assert.match(state.stdout, /Generated commit message/);
  assert.match(state.stderr, /Preparing agent API/);
  assert.match(state.stderr, /Committed successfully/);
  assert.match(state.stderr, /still have unstaged changes/);
  assert.match(state.stderr, /Agent: DeepSeek/);
});

test("offers to stage unstaged changes and prints a draft", async () => {
  const { io, state } = workflowIo();
  const calls = [];
  let generation = 0;

  const status = await runCommitWorkflow({}, io, {
    config: {
      AGENT_API_KEY: "fixture-key",
      AGENT_PROVIDER: "openai",
      "auto-stage-all": false,
      "show-scope": true,
      "show-usage-summary": false,
    },
    async createRuntime() {
      return {
        async dispose() {
          calls.push("dispose");
        },
      };
    },
    async generate(options) {
      generation += 1;
      options.onStatus({ phase: "collecting" });

      if (generation === 1) {
        const error = new Error("Nothing staged");
        error.code = "NO_STAGED_CHANGES";
        throw error;
      }

      options.onStatus({ phase: "preparing-agent" });
      options.onStatus({ phase: "generating" });
      return "fix: guard missing profiles";
    },
    async hasChanges() {
      return true;
    },
    async promptGeneratedCommit() {
      return null;
    },
    async promptNoStagedChanges() {
      return "stage";
    },
    async stageChanges() {
      calls.push("stage");
    },
  });

  assert.equal(status, 0);
  assert.equal(generation, 2);
  assert.deepEqual(calls, ["stage", "dispose"]);
  assert.equal(state.stdout, "fix: guard missing profiles\n");
  assert.match(state.stderr, /Checking unstaged changes/);
  assert.match(state.stderr, /Staging all changes/);
});

test("regenerates a reviewed draft before committing", async () => {
  const { io } = workflowIo();
  const actions = ["regenerate", "commit"];
  const messages = ["feat: first draft", "feat: second draft"];
  const generatedOptions = [];
  let committed;

  const status = await runCommitWorkflow({}, io, {
    commitChanges: async (options) => {
      committed = options;
    },
    config: {
      AGENT_API_KEY: "fixture-key",
      AGENT_PROVIDER: "claude",
      "auto-stage-all": false,
      "show-scope": true,
      "show-usage-summary": false,
    },
    createRuntime: async () => ({ async dispose() {} }),
    generate: async (options) => {
      generatedOptions.push(options);
      return messages.shift();
    },
    hasChanges: async () => false,
    promptGeneratedCommit: async () => actions.shift(),
  });

  assert.equal(status, 0);
  assert.deepEqual(generatedOptions[1].previousMessages, ["feat: first draft"]);
  assert.equal(committed.message, "feat: second draft");
});
