import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";

import { NoStagedChangesError, collectStagedChanges } from "../src/git.mjs";
import { createRepository, git } from "../support/git-fixture.mjs";

test("collects only staged changes and recent commit style", async (t) => {
  const directory = await createRepository(t);

  await writeFile(
    join(directory, "staged.js"),
    "export const staged = true;\n",
  );
  await writeFile(
    join(directory, "unstaged.js"),
    "export const unstaged = true;\n",
  );
  await git(directory, "add", "staged.js");

  const context = await collectStagedChanges({ cwd: directory });

  assert.equal(context.repository, basename(directory));
  assert.deepEqual(context.files, [{ status: "A", path: "staged.js" }]);
  assert.match(context.diff, /staged = true/);
  assert.doesNotMatch(context.diff, /unstaged = true/);
  assert.deepEqual(context.recentSubjects, ["chore: initialize fixture"]);
  assert.equal(context.diffTruncated, false);
});

test("supports a staged change in a repository without commits", async (t) => {
  const directory = await createRepository(t, { initialCommit: false });

  await writeFile(join(directory, "first.txt"), "first\n");
  await git(directory, "add", "first.txt");

  const context = await collectStagedChanges({ cwd: directory });

  assert.deepEqual(context.files, [{ status: "A", path: "first.txt" }]);
  assert.deepEqual(context.recentSubjects, []);
  assert.match(context.diff, /first/);
});

test("reports when there are no staged changes", async (t) => {
  const directory = await createRepository(t);

  await writeFile(join(directory, "README.md"), "# unstaged only\n");

  await assert.rejects(
    collectStagedChanges({ cwd: directory }),
    (error) =>
      error instanceof NoStagedChangesError &&
      error.code === "NO_STAGED_CHANGES",
  );
});

test("bounds oversized diffs without dropping file status", async (t) => {
  const directory = await createRepository(t);

  await writeFile(join(directory, "large.txt"), `${"content\n".repeat(200)}`);
  await git(directory, "add", "large.txt");

  const context = await collectStagedChanges({
    cwd: directory,
    maxDiffBytes: 120,
  });

  assert.deepEqual(context.files, [{ status: "A", path: "large.txt" }]);
  assert.ok(Buffer.byteLength(context.diff) <= 120);
  assert.equal(context.diffTruncated, true);
});

test("parses staged renames", async (t) => {
  const directory = await createRepository(t);

  await git(directory, "mv", "README.md", "ABOUT.md");

  const context = await collectStagedChanges({ cwd: directory });

  assert.deepEqual(context.files, [
    {
      status: "R100",
      path: "ABOUT.md",
      previousPath: "README.md",
    },
  ]);
});

test("omits binary payloads from the staged prompt input", async (t) => {
  const directory = await createRepository(t);

  await writeFile(join(directory, ".gitattributes"), "*.bin diff=leak\n");
  await writeFile(
    join(directory, "fixture.bin"),
    Buffer.from([0, 1, 2, 3, 255, 0, 10]),
  );
  await git(
    directory,
    "config",
    "diff.leak.textconv",
    "gikum-textconv-must-not-run",
  );
  await git(directory, "add", ".gitattributes", "fixture.bin");

  const context = await collectStagedChanges({ cwd: directory });

  assert.match(context.diff, /Binary files/);
  assert.doesNotMatch(context.diff, /\u0000/);
});
