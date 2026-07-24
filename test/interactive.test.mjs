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
    color: true,
    input,
    message:
      "feat(cli): review generated commits\n\nLet developers approve the message before Git writes it.",
    output,
  });

  input.end("\r");

  assert.equal(await answer, "commit");
  const plainDisplay = stripAnsi(displayed);

  assert.match(plainDisplay, /Generated commit message/);
  assert.match(plainDisplay, /feat\(cli\): review generated commits/);
  assert.match(plainDisplay, /Let developers approve/);
  assert.match(plainDisplay, /❯ Commit/);
  assert.match(plainDisplay, /Generate again/);
  assert.match(plainDisplay, /Cancel/);
  assert.match(displayed, /\u001B\[1;32mfeat\u001B\[0m/);
  assert.match(displayed, /\u001B\[36m\(cli\)\u001B\[0m/);
  assert.match(displayed, /\u001B\[1;32m❯\u001B\[0m/);
  assert.deepEqual(input.rawModeChanges, [true, false]);
});

test("selects Generate again with the down arrow", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForGeneratedCommit({
    color: true,
    input,
    message: "feat(cli): review generated commits",
    output,
  });

  input.end("\u001B[B\r");

  assert.equal(await answer, "regenerate");
  assert.match(displayed, /\u001B\[1;33m❯\u001B\[0m/);
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

test("can render the review without ANSI color", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForGeneratedCommit({
    color: false,
    input,
    message: "feat(cli): review generated commits",
    output,
  });

  input.end("\r");

  assert.equal(await answer, "commit");
  assert.doesNotMatch(displayed, /\u001B\[(?:1;)?(?:3[0-9]|90)m/);
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

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
