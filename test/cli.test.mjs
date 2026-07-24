import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUILT_IN_MODEL, run } from "../src/index.mjs";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const packageJsonUrl = new URL("../package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(packageJsonUrl, "utf8"));

function fixtureRuntimeInfo() {
  return {
    contextSize: 16_384,
    maxTokens: 256,
    cpu: {
      model: "Fixture CPU",
      logicalCores: 12,
      mathCores: 8,
      ramBytes: 32_000_000_000,
    },
    gpu: {
      backend: "metal",
      devices: ["Fixture GPU"],
      memoryBytes: 20_000_000_000,
      unifiedMemory: true,
    },
  };
}

test("prints help when requested", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^gitkum\n/);
  assert.match(result.stdout, /gitkum \[options\]/);
  assert.match(result.stdout, /Generate concise Git commit messages/);
  assert.match(result.stdout, /--clear-model/);
  assert.match(result.stdout, /--model-info/);
});

test("prints help for the commit wrapper", () => {
  const result = spawnSync(process.execPath, [cli, "commit", "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^gitkum commit\n/);
  assert.match(result.stdout, /--all/);
  assert.match(result.stdout, /--yes/);
  assert.match(result.stdout, /-- GIT_ARGS/);
  assert.match(result.stdout, /--no-verify/);
});

test("prints the package version", () => {
  const result = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${version}\n`);
});

test("shows information about the downloaded built-in model", async () => {
  let calls = 0;
  let runtimeCalls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run(["--model-info"], io, {
    async getModelInfo() {
      calls += 1;
      return {
        model: BUILT_IN_MODEL,
        path: "/cache/built-in.gguf",
        state: "ready",
        file: {
          byteLength: BUILT_IN_MODEL.byteLength,
          modifiedAt: "2026-07-24T00:00:00.000Z",
        },
      };
    },
    async inspectRuntime() {
      runtimeCalls += 1;
      return fixtureRuntimeInfo();
    },
  });

  assert.equal(status, 0);
  assert.equal(calls, 1);
  assert.equal(runtimeCalls, 1);
  assert.equal(stderr, "");
  assert.match(stdout, /^Built-in model\n/);
  assert.match(stdout, /Name: Qwen2\.5-Coder-1\.5B-Instruct Q4_K_M/);
  assert.match(stdout, /Parameters: 1\.78B \(1,777,088,000\)/);
  assert.match(stdout, /Quantization: Q4_K_M/);
  assert.match(stdout, /Context: 32,768 tokens \(16,384 used by gitkum\)/);
  assert.match(stdout, /Output limit: 256 tokens/);
  assert.match(stdout, /Status: downloaded and verified/);
  assert.match(stdout, /Path: \/cache\/built-in\.gguf/);
  assert.match(stdout, /Size: 1\.12 GB \(1,117,320,768 bytes\)/);
  assert.match(stdout, new RegExp(`SHA-256: ${BUILT_IN_MODEL.sha256}`));
  assert.match(stdout, /Source: https:\/\/huggingface\.co\//);
  assert.match(
    stdout,
    /CPU: Fixture CPU \(8 math cores, 12 logical cores, 32\.0 GB RAM\)/,
  );
  assert.match(stdout, /GPU: Metal \(Fixture GPU, 20\.0 GB unified memory\)/);
});

test("reports when the built-in model has not been downloaded", async () => {
  let stdout = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write() {} },
  };

  const status = await run(["--model-info"], io, {
    async getModelInfo() {
      return {
        model: BUILT_IN_MODEL,
        path: "/cache/built-in.gguf",
        state: "missing",
        file: null,
      };
    },
    async inspectRuntime() {
      return fixtureRuntimeInfo();
    },
  });

  assert.equal(status, 0);
  assert.match(stdout, /Status: not downloaded/);
});

test("downloads the single built-in model without asking for a choice", async () => {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run(["--download-model"], io, {
    async ensureModel({ onProgress }) {
      calls += 1;
      onProgress({ downloaded: 0, total: 10 });
      onProgress({ downloaded: 5, total: 10 });
      onProgress({ downloaded: 10, total: 10 });
      return { downloaded: true, path: "/cache/built-in.gguf" };
    },
  });

  assert.equal(status, 0);
  assert.equal(calls, 1);
  assert.match(stderr, /Preparing Qwen2\.5-Coder/);
  assert.match(stderr, /\[############------------\]/);
  assert.match(stderr, /50%/);
  assert.match(stderr, /\[########################\]/);
  assert.match(stderr, /100%/);
  assert.match(stdout, /ready \(downloaded\): \/cache\/built-in\.gguf/);
});

test("redraws download progress on one line in a terminal", async () => {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: {
      isTTY: true,
      write: (value) => (stderr += value),
    },
  };

  const status = await run(["--download-model"], io, {
    async ensureModel({ onProgress }) {
      onProgress({ downloaded: 0, total: 1_000_000_000 });
      onProgress({ downloaded: 500_000_000, total: 1_000_000_000 });
      onProgress({
        downloaded: 1_000_000_000,
        total: 1_000_000_000,
      });
      return { downloaded: true, path: "/cache/built-in.gguf" };
    },
  });

  assert.equal(status, 0);
  assert.match(
    stderr,
    /\rDownloading model \[############------------\]\s+50%\s+500 MB \/ 1\.00 GB/,
  );
  assert.match(
    stderr,
    /\rDownloading model \[########################\]\s+100%\s+1\.00 GB \/ 1\.00 GB\n$/,
  );
  assert.match(stdout, /ready \(downloaded\)/);
});

test("clears the downloaded built-in model", async () => {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run(["--clear-model"], io, {
    async clearModel() {
      calls += 1;
      return { cleared: true, path: "/cache/built-in.gguf" };
    },
  });

  assert.equal(status, 0);
  assert.equal(calls, 1);
  assert.equal(stderr, "");
  assert.equal(stdout, "Built-in model cleared: /cache/built-in.gguf\n");
});

test("reports when the built-in model cache is already clear", async () => {
  let stdout = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write() {} },
  };

  const status = await run(["--clear-model"], io, {
    async clearModel() {
      return { cleared: false, path: "/cache/built-in.gguf" };
    },
  });

  assert.equal(status, 0);
  assert.equal(stdout, "Built-in model is not cached: /cache/built-in.gguf\n");
});

test("generates a commit message with no arguments", async () => {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run([], io, {
    async generate({ onStatus }) {
      onStatus({ phase: "collecting" });
      onStatus({ phase: "loading-model" });
      onStatus({ phase: "generating" });
      return "feat(cli): generate staged commit messages";
    },
  });

  assert.equal(status, 0);
  assert.equal(stdout, "feat(cli): generate staged commit messages\n");
  assert.match(stderr, /Collecting staged changes/);
  assert.match(stderr, /Changes found/);
  assert.match(stderr, /Loading local model/);
  assert.match(stderr, /Generating commit message/);
});

test("prints only the message when standard output is redirected", async () => {
  let stdout = "";
  let stderr = "";
  const io = {
    stdin: { isTTY: true },
    stdout: {
      isTTY: false,
      write: (value) => (stdout += value),
    },
    stderr: {
      isTTY: true,
      write: (value) => (stderr += value),
    },
  };

  const status = await run([], io, {
    async generate() {
      return "feat(cli): preserve command substitution";
    },
  });

  assert.equal(status, 0);
  assert.equal(stdout, "feat(cli): preserve command substitution\n");
  assert.equal(stderr, "");
});

test("prints aggregate token, CPU, and GPU usage to standard error", async () => {
  let stdout = "";
  let stderr = "";
  const io = {
    stdin: { isTTY: true },
    stdout: {
      isTTY: false,
      write: (value) => (stdout += value),
    },
    stderr: {
      isTTY: true,
      write: (value) => (stderr += value),
    },
  };

  const status = await run([], io, {
    createRuntime() {
      return {
        async dispose() {},
        getUsage() {
          return {
            generations: 2,
            tokens: {
              input: 2_000,
              output: 48,
              total: 2_048,
            },
            wallTimeMs: 2_500,
            cpu: {
              model: "Fixture CPU",
              timeMs: 350,
              memoryBytes: 250_000_000,
            },
            gpu: {
              backend: "metal",
              devices: ["Fixture GPU"],
              memoryBytes: 1_100_000_000,
            },
          };
        },
      };
    },
    async generate() {
      return "feat(cli): report local inference usage";
    },
  });

  assert.equal(status, 0);
  assert.equal(stdout, "feat(cli): report local inference usage\n");
  assert.match(stderr, /Tokens: 2,048 total \(2,000 input, 48 output\)/);
  assert.match(stderr, /Wall time: 2\.50 s/);
  assert.match(stderr, /CPU: Fixture CPU, 350 ms time, 250 MB allocated/);
  assert.match(stderr, /GPU: Metal, Fixture GPU, 1\.10 GB allocated/);
});

test("commits the approved generated message", async () => {
  const message =
    "feat(cli): review generated commits\n\n" +
    "Let developers approve the message before Git writes it.";
  const calls = [];
  let stdout = "";
  let stderr = "";
  const io = {
    stdin: {},
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run([], io, {
    cwd: "/worktree",
    async commitChanges(options) {
      calls.push(["commit", options]);
      return {
        stdout: "[branch abc1234] feat(cli): review generated commits\n",
        stderr: "",
      };
    },
    async generate() {
      calls.push(["generate"]);
      return message;
    },
    async promptGeneratedCommit(options) {
      calls.push(["prompt", options.message]);
      return "commit";
    },
  });

  assert.equal(status, 0);
  assert.equal(calls[1][1], message);
  assert.deepEqual(calls[2][1], {
    cwd: "/worktree",
    message,
  });
  assert.equal(
    stdout,
    "[branch abc1234] feat(cli): review generated commits\n",
  );
  assert.equal(stderr, "");
});

test("commit command reviews and commits the generated message", async () => {
  const message = "feat(cli): add the commit wrapper";
  const committed = [];
  let disposed = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write: (value) => (stdout += value),
    },
    stderr: {
      isTTY: true,
      write: (value) => (stderr += value),
    },
  };

  const status = await run(["commit"], io, {
    cwd: "/worktree",
    async commitChanges(options) {
      committed.push(options);
      return {
        stdout: "[branch abc1234] feat(cli): add the commit wrapper\n",
        stderr: "",
      };
    },
    createRuntime() {
      return {
        async dispose() {
          disposed += 1;
        },
      };
    },
    async generate() {
      return message;
    },
    async promptGeneratedCommit({ message: proposal }) {
      assert.equal(proposal, message);
      return "commit";
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(committed, [
    {
      args: [],
      cwd: "/worktree",
      message,
    },
  ]);
  assert.equal(disposed, 1);
  assert.match(
    stderr,
    /\$ git commit --message 'feat\(cli\): add the commit wrapper' --/,
  );
  assert.match(stdout, /\[branch abc1234\]/);
});

test("commit --all --yes stages, commits, and forwards Git arguments", async () => {
  const calls = [];
  const message = "feat(cli): forward git commit flags";
  let stdout = "";
  let stderr = "";
  const io = {
    stdin: { isTTY: false },
    stdout: {
      isTTY: false,
      write: (value) => (stdout += value),
    },
    stderr: {
      isTTY: false,
      write: (value) => (stderr += value),
    },
  };

  const status = await run(
    ["commit", "--all", "--yes", "--", "--no-verify", "--signoff"],
    io,
    {
      cwd: "/worktree",
      async commitChanges(options) {
        calls.push(["commit", options]);
        return { stdout: "committed\n", stderr: "" };
      },
      createRuntime() {
        calls.push(["runtime"]);
        return {
          async dispose() {
            calls.push(["dispose"]);
          },
        };
      },
      async generate() {
        calls.push(["generate"]);
        return message;
      },
      async promptGeneratedCommit() {
        throw new Error("automatic confirmation must not prompt");
      },
      async promptNoStagedChanges() {
        throw new Error("--all must not prompt before staging");
      },
      async stageChanges(options) {
        calls.push(["stage", options]);
      },
    },
  );

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    ["stage", { cwd: "/worktree" }],
    ["runtime"],
    ["generate"],
    ["dispose"],
    [
      "commit",
      {
        args: ["--no-verify", "--signoff"],
        cwd: "/worktree",
        message,
      },
    ],
  ]);
  assert.match(stdout, /Generated commit message:\n\nfeat\(cli\)/);
  assert.match(stdout, /committed/);
  assert.match(stderr, /^\$ git add --all --/);
  assert.match(stderr, /--no-verify --signoff --/);
});

test("commit requires --yes outside an interactive terminal", async () => {
  let commandCalls = 0;
  let stderr = "";
  const io = {
    stdin: { isTTY: false },
    stdout: { isTTY: false, write() {} },
    stderr: {
      isTTY: false,
      write: (value) => (stderr += value),
    },
  };

  const status = await run(["commit"], io, {
    createRuntime() {
      commandCalls += 1;
    },
    async generate() {
      commandCalls += 1;
    },
    async stageChanges() {
      commandCalls += 1;
    },
  });

  assert.equal(status, 1);
  assert.equal(commandCalls, 0);
  assert.match(stderr, /needs an interactive terminal/);
  assert.match(stderr, /--yes/);
});

test("commit reports a clean tree after --all without loading the model", async () => {
  let commitCalls = 0;
  let disposed = 0;
  let stageCalls = 0;
  let stderr = "";
  const io = {
    stdin: { isTTY: false },
    stdout: { isTTY: false, write() {} },
    stderr: {
      isTTY: false,
      write: (value) => (stderr += value),
    },
  };

  const status = await run(["commit", "--all", "--yes"], io, {
    async commitChanges() {
      commitCalls += 1;
    },
    createRuntime() {
      return {
        async dispose() {
          disposed += 1;
        },
      };
    },
    async generate() {
      const error = new Error("No staged changes found.");
      error.code = "NO_STAGED_CHANGES";
      throw error;
    },
    async stageChanges() {
      stageCalls += 1;
    },
  });

  assert.equal(status, 1);
  assert.equal(stageCalls, 1);
  assert.equal(commitCalls, 0);
  assert.equal(disposed, 1);
  assert.match(stderr, /^\$ git add --all --/);
  assert.match(stderr, /No staged changes found/);
});

test("generates again before committing the replacement message", async () => {
  const messages = [
    "feat(cli): add generated commit menu",
    "feat(cli): review generated commits",
  ];
  const actions = ["regenerate", "commit"];
  const committed = [];
  const previousMessageSets = [];
  const runtimes = [];
  let disposed = 0;
  let generateCalls = 0;
  const io = {
    stdin: {},
    stdout: { write() {} },
    stderr: { write() {} },
  };

  const status = await run([], io, {
    async commitChanges({ message }) {
      committed.push(message);
      return { stdout: "", stderr: "" };
    },
    createRuntime() {
      return {
        async dispose() {
          disposed += 1;
        },
      };
    },
    async generate({ previousMessages, runtime }) {
      previousMessageSets.push(previousMessages);
      runtimes.push(runtime);
      return messages[generateCalls++];
    },
    async promptGeneratedCommit() {
      return actions.shift();
    },
  });

  assert.equal(status, 0);
  assert.equal(generateCalls, 2);
  assert.deepEqual(committed, [messages[1]]);
  assert.deepEqual(previousMessageSets, [undefined, [messages[0]]]);
  assert.equal(runtimes[0], runtimes[1]);
  assert.equal(disposed, 1);
});

test("cancels without committing the generated message", async () => {
  let commitCalls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdin: {},
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run([], io, {
    async commitChanges() {
      commitCalls += 1;
    },
    async generate() {
      return "feat(cli): review generated commits";
    },
    async promptGeneratedCommit() {
      return "cancel";
    },
  });

  assert.equal(status, 0);
  assert.equal(commitCalls, 0);
  assert.equal(stdout, "");
  assert.equal(stderr, "Cancelled.\n");
});

test("can stage all changes and retry generation", async () => {
  let generateCalls = 0;
  let promptCalls = 0;
  let stageCalls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run([], io, {
    cwd: "/worktree",
    async generate({ onStatus }) {
      generateCalls += 1;
      onStatus({ phase: "collecting" });

      if (generateCalls === 1) {
        const error = new Error("No staged changes found.");
        error.code = "NO_STAGED_CHANGES";
        throw error;
      }

      return "feat(cli): stage changes before generation";
    },
    async hasChanges({ cwd }) {
      assert.equal(cwd, "/worktree");
      return true;
    },
    async promptNoStagedChanges() {
      promptCalls += 1;
      return "stage";
    },
    async stageChanges({ cwd }) {
      stageCalls += 1;
      assert.equal(cwd, "/worktree");
    },
  });

  assert.equal(status, 0);
  assert.equal(generateCalls, 2);
  assert.equal(promptCalls, 1);
  assert.equal(stageCalls, 1);
  assert.equal(stdout, "feat(cli): stage changes before generation\n");
  assert.match(stderr, /Changes found/);
  assert.match(stderr, /Staging all changes/);
});

test("can cancel without staging changes", async () => {
  let stageCalls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run([], io, {
    async generate() {
      const error = new Error("No staged changes found.");
      error.code = "NO_STAGED_CHANGES";
      throw error;
    },
    async hasChanges() {
      return true;
    },
    async promptNoStagedChanges() {
      return "cancel";
    },
    async stageChanges() {
      stageCalls += 1;
    },
  });

  assert.equal(status, 0);
  assert.equal(stageCalls, 0);
  assert.equal(stdout, "");
  assert.equal(stderr, "Changes found.\nCancelled.\n");
});

test("rejects unknown options", async () => {
  let stderr = "";
  const io = {
    stdout: { write() {} },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run(["--model", "other.gguf"], io);

  assert.equal(status, 2);
  assert.match(stderr, /Unknown option/);
  assert.match(stderr, /does not expose model selection/);
});

test("rejects unknown commit options before the Git separator", async () => {
  let stderr = "";
  const io = {
    stdout: { write() {} },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run(["commit", "--no-verify"], io);

  assert.equal(status, 2);
  assert.match(stderr, /Unknown commit option: --no-verify/);
  assert.match(stderr, /gitkum commit --help/);
});

test("aborts a clean tree without showing the staging menu", async () => {
  let promptCalls = 0;
  let stderr = "";
  const io = {
    stdout: { write() {} },
    stderr: { write: (value) => (stderr += value) },
  };

  const status = await run([], io, {
    async generate() {
      const error = new Error("No staged changes found.");
      error.code = "NO_STAGED_CHANGES";
      throw error;
    },
    async hasChanges() {
      return false;
    },
    async promptNoStagedChanges() {
      promptCalls += 1;
    },
  });

  assert.equal(status, 1);
  assert.equal(promptCalls, 0);
  assert.equal(stderr, "No staged changes found.\n");
});
