import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { promptForNoStagedChanges } from "../src/interactive.mjs";

test("offers to stage all changes in an interactive terminal", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForNoStagedChanges({ input, output });

  input.end("1\n");

  assert.equal(await answer, "stage");
  assert.match(displayed, /Stage all changes and continue/);
  assert.match(displayed, /Cancel/);
});

test("defaults to cancelling and retries invalid answers", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForNoStagedChanges({ input, output });

  input.end("not-an-option\n\n");

  assert.equal(await answer, "cancel");
  assert.match(displayed, /Please enter 1 to stage or 2 to cancel/);
});

test("does not prompt when input is non-interactive", async () => {
  const input = new PassThrough();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  assert.equal(await promptForNoStagedChanges({ input, output }), null);
  assert.equal(displayed, "");
});

function createTtyStream() {
  const stream = new PassThrough();

  stream.isTTY = true;
  return stream;
}
