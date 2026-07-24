import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CommitCommandUsageError,
  formatGitCommand,
  parseCommitCommandArgs,
} from "../src/commit.mjs";

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
