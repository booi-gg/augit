import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  formatChangesStatus,
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

  input.write("\r");

  assert.equal(await answer, "commit");
  const plainDisplay = stripAnsi(displayed);

  assert.doesNotMatch(plainDisplay, /Generated commit message/);
  assert.match(plainDisplay, /feat\(cli\): review generated commits/);
  assert.match(plainDisplay, /Let developers approve/);
  assert.match(plainDisplay, /❯ Commit/);
  assert.match(plainDisplay, /Generate again/);
  assert.match(plainDisplay, /Cancel/);
  assert.match(
    displayed,
    /\u001B\[1;38;5;120mfeat\(cli\): review generated commits\u001B\[0m/,
  );
  assert.match(displayed, /\u001B\[1;32m❯\u001B\[0m/);
  assert.deepEqual(input.rawModeChanges, [true, false]);
  assert.equal(input.isPaused(), true);

  input.destroy();
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

test("selects Generate again with its shortcut", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForGeneratedCommit({
    input,
    message: "feat(cli): review generated commits",
    output,
  });

  input.write("r");

  assert.equal(await answer, "regenerate");
  input.destroy();
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

test("formats staged-change statuses with terminal colors", () => {
  assert.equal(
    formatChangesStatus(true, { color: true }),
    "\u001B[94mFound!\u001B[0m",
  );
  assert.equal(
    formatChangesStatus(false, { color: true }),
    "\u001B[38;5;208mNot found!\u001B[0m",
  );
  assert.equal(formatChangesStatus(false, { color: false }), "Not found!");
});

test("offers to stage detected unstaged changes", async () => {
  const input = createTtyStream();
  const output = createTtyStream();
  let displayed = "";

  output.on("data", (chunk) => {
    displayed += chunk;
  });

  const answer = promptForNoStagedChanges({ input, output });

  input.write("\r");

  assert.equal(await answer, "stage");
  const plainDisplay = stripAnsi(displayed);
  assert.match(plainDisplay, /\[UP\] and \[DOWN\] arrow keys/i);
  assert.match(plainDisplay, /❯ Stage all changes and continue/);
  assert.match(plainDisplay, /Cancel/);
  assert.doesNotMatch(plainDisplay, /No staged changes found/);
  assert.deepEqual(input.rawModeChanges, [true, false]);
  assert.equal(input.isPaused(), true);

  input.destroy();
});

test("can cancel instead of staging detected changes", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForNoStagedChanges({ input, output });

  input.end("\u001B[B\r");

  assert.equal(await answer, "cancel");
});

test("selects staging with its shortcut", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForNoStagedChanges({ input, output });

  input.write("a");

  assert.equal(await answer, "stage");
  input.destroy();
});

test("cancels the staging choice when input ends", async () => {
  const input = createTtyStream();
  const output = createTtyStream();

  const answer = promptForNoStagedChanges({ input, output });

  input.end();

  assert.equal(await answer, "cancel");
});

test("does not offer staging outside a terminal", async () => {
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
