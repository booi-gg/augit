import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { promptForNoStagedChanges } from "../src/interactive.mjs";

test("selects stage with the up arrow and Enter", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForNoStagedChanges({ input, output });

  input.end("\u001B[A\r");

  assert.equal(await answer, "stage");
  assert.match(displayed, /up and down arrow keys/);
  assert.match(displayed, /Stage all changes and continue/);
  assert.match(displayed, /Cancel/);
  assert.deepEqual(input.rawModeChanges, [true, false]);
});

test("defaults to cancelling when Enter is pressed", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForNoStagedChanges({ input, output });

  input.end("\r");

  assert.equal(await answer, "cancel");
});

test("moves down from stage to cancel", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForNoStagedChanges({ input, output });

  input.end("\u001B[A\u001B[B\r");

  assert.equal(await answer, "cancel");
});

test("cancels when the input stream ends without a selection", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForNoStagedChanges({ input, output });

  input.end();

  assert.equal(await answer, "cancel");
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
  stream.isRaw = false;
  stream.rawModeChanges = [];
  stream.setRawMode = (isRaw) => {
    stream.isRaw = isRaw;
    stream.rawModeChanges.push(isRaw);
  };

  return stream;
}
