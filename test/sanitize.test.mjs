import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeGitContext } from "../src/sanitize.mjs";

test("redacts common credentials before inference", () => {
  const context = sanitizeGitContext({
    repository: "fixture",
    files: [{ status: "M", path: "config.js" }],
    recentSubjects: [],
    diff:
      '+password = "hunter2"\n' +
      "+token = ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n" +
      "+-----BEGIN PRIVATE KEY-----\n+truncated-key-material\n",
    diffTruncated: false,
  });

  assert.doesNotMatch(context.diff, /hunter2/);
  assert.doesNotMatch(context.diff, /ghp_/);
  assert.doesNotMatch(context.diff, /key-material/);
  assert.match(context.diff, /\[REDACTED\]/);
  assert.equal(context.redactionCount, 3);
});

test("bounds files, history, paths, and UTF-8 diff input", () => {
  const context = sanitizeGitContext(
    {
      repository: "r".repeat(200),
      files: Array.from({ length: 4 }, (_, index) => ({
        status: "M",
        path: `src/${index}-${"x".repeat(100)}.js`,
      })),
      recentSubjects: ["one", "two", "three"],
      diff: "🙂".repeat(100),
      diffTruncated: false,
    },
    {
      maxDiffBytes: 21,
      maxFiles: 2,
      maxHistory: 2,
      maxPathLength: 30,
      maxRepositoryLength: 20,
    },
  );

  assert.equal(context.repository.length, 20);
  assert.equal(context.files.length, 2);
  assert.equal(context.filesTruncated, true);
  assert.equal(context.recentSubjects.length, 2);
  assert.ok(context.files.every((file) => file.path.length <= 30));
  assert.ok(Buffer.byteLength(context.diff) <= 21);
  assert.equal(context.diffTruncated, true);
  assert.doesNotMatch(context.diff, /\uFFFD/);
});
