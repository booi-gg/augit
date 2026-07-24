import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../src/index.mjs";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const packageJsonUrl = new URL("../package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(packageJsonUrl, "utf8"));

test("prints help when requested", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^gitkum\n/);
  assert.match(result.stdout, /gitkum \[options\]/);
  assert.match(result.stdout, /Generate concise Git commit messages/);
  assert.match(result.stdout, /--clear-model/);
});

test("prints the package version", () => {
  const result = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${version}\n`);
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
      onProgress({ downloaded: 5, total: 10 });
      return { downloaded: true, path: "/cache/built-in.gguf" };
    },
  });

  assert.equal(status, 0);
  assert.equal(calls, 1);
  assert.match(stderr, /Preparing Qwen2\.5-Coder/);
  assert.match(stderr, /50%/);
  assert.match(stdout, /ready \(downloaded\): \/cache\/built-in\.gguf/);
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
  assert.match(stderr, /Loading local model/);
  assert.match(stderr, /Generating commit message/);
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

test("prints generation errors without a stack trace", async () => {
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
  });

  assert.equal(status, 1);
  assert.equal(stderr, "No staged changes found.\n");
});
