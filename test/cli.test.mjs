import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../src/index.mjs";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

test("prints help with no arguments", () => {
  const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Generate concise Git commit messages/);
});

test("prints the package version", () => {
  const result = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "0.0.0\n");
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
