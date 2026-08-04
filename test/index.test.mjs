import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/index.mjs";

function fixtureIo() {
  const state = { stderr: "", stdout: "" };
  const io = {
    stdout: { write: (value) => (state.stdout += value) },
    stderr: { write: (value) => (state.stderr += value) },
  };

  return { io, state };
}

test("routes --clear-model to the legacy model cleanup", async () => {
  const { io, state } = fixtureIo();
  const path = "/cache/augi/models/legacy.gguf";
  let calls = 0;

  const status = await run(["--clear-model"], io, {
    async clearModel() {
      calls += 1;
      return { path, cleared: true };
    },
  });

  assert.equal(status, 0);
  assert.equal(calls, 1);
  assert.equal(state.stdout, `Built-in model cleared: ${path}\n`);
  assert.equal(state.stderr, "");
});

test("reports legacy model cleanup failures", async () => {
  const { io, state } = fixtureIo();

  const status = await run(["--clear-model"], io, {
    async clearModel() {
      throw new Error("Could not remove the cached model.");
    },
  });

  assert.equal(status, 1);
  assert.equal(state.stdout, "");
  assert.equal(state.stderr, "Could not remove the cached model.\n");
});
