import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  promptForGeneratedCommit,
  promptForNoStagedChanges,
} from "../src/interactive.mjs";

test("shows the generated message and defaults to committing", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForGeneratedCommit({
    input,
    message:
      "feat(cli): review generated commits\n\nLet developers approve the message before Git writes it.",
    output,
  });

  input.end("\r");

  assert.equal(await answer, "commit");
  assert.match(displayed, /Generated commit message/);
  assert.match(displayed, /feat\(cli\): review generated commits/);
  assert.match(displayed, /Let developers approve/);
  assert.match(displayed, /❯ Commit/);
  assert.match(displayed, /Generate again/);
  assert.match(displayed, /Cancel/);
  assert.deepEqual(input.rawModeChanges, [true, false]);
});

test("selects Generate again with the down arrow", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForGeneratedCommit({
    input,
    message: "feat(cli): review generated commits",
    output,
  });

  input.end("\u001B[B\r");

  assert.equal(await answer, "regenerate");
});

test("selects Cancel from the generated commit menu", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForGeneratedCommit({
    input,
    message: "feat(cli): review generated commits",
    output,
  });

  input.end("\u001B[B\u001B[B\r");

  assert.equal(await answer, "cancel");
});

test("does not show the generated commit menu outside a terminal", async () => {
  const input = new PassThrough();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  assert.equal(
    await promptForGeneratedCommit({
      input,
      message: "feat(cli): review generated commits",
      output,
    }),
    null,
  );
  assert.equal(displayed, "");
});

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
