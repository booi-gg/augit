import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findSummaryProblem,
  MAX_SUMMARY_DIFF_CHARS,
  normalizeSummary,
  planSummaryUnits,
} from "../src/summarize.mjs";

function newFileDiff(lines) {
  return (
    "diff --git a/src/big.mjs b/src/big.mjs\n" +
    "new file mode 100644\n" +
    "--- /dev/null\n" +
    "+++ b/src/big.mjs\n" +
    "@@ -0,0 +1," +
    lines +
    " @@\n" +
    Array.from(
      { length: lines },
      (_, index) => `+const value${index} = 1;`,
    ).join("\n") +
    "\n"
  );
}

test("keeps every unit inside the per-call budget", () => {
  const { units } = planSummaryUnits(newFileDiff(600));

  assert.ok(units.length > 1, "an oversized file must be split");

  for (const unit of units) {
    assert.ok(
      unit.diff.length <= MAX_SUMMARY_DIFF_CHARS,
      `unit of ${unit.diff.length} chars exceeds the budget`,
    );
  }
});

test("splits a newly added file, whose whole diff is one hunk", () => {
  const { units } = planSummaryUnits(newFileDiff(600));

  assert.ok(units.length > 1);
  assert.equal(units[0].partCount, units.length);
  // Every part must say where in the file it sits.
  for (const unit of units) {
    assert.match(unit.diff, /@@/);
  }
});

test("loses no changed line when splitting", () => {
  const { units, unitsDropped } = planSummaryUnits(newFileDiff(600));
  const counted = units.reduce((total, unit) => total + unit.changedLines, 0);

  assert.equal(unitsDropped, 0);
  assert.equal(counted, 600);
});

test("orders units so the largest file is read first", () => {
  const { units } = planSummaryUnits(
    "diff --git a/package.json b/package.json\n" +
      "@@ -1,2 +1,2 @@\n" +
      '-  "version": "1.0.0"\n' +
      '+  "version": "1.1.0"\n' +
      "diff --git a/src/rewrite.js b/src/rewrite.js\n" +
      "@@ -1,3 +1,3 @@\n" +
      "+const a = 1;\n+const b = 2;\n+const c = 3;\n",
  );

  assert.equal(units[0].path, "src/rewrite.js");
  assert.equal(units.at(-1).path, "package.json");
});

test("rejects a summary that is a commit message copied from a fixture", () => {
  assert.match(
    findSummaryProblem("feat(core): return a default display name", {}),
    /commit message/,
  );
  assert.match(
    findSummaryProblem("fix: guard a missing profile", {}),
    /commit message/,
  );
});

test("rejects a summary whose verb states an intention", () => {
  assert.match(
    findSummaryProblem("improve readability of the parser", {}),
    /"improve"/,
  );
  assert.match(
    findSummaryProblem("optimize the token budget", {}),
    /"optimize"/,
  );
});

test("rejects a summary that only restates the file metadata", () => {
  assert.match(
    findSummaryProblem(
      "Added a new file src/diff.mjs with 96 changed lines",
      {},
    ),
    /metadata/,
  );
  assert.match(
    findSummaryProblem("src/diff.mjs", { path: "src/diff.mjs" }),
    /metadata/,
  );
});

test("rejects a summary copied out of a comment in the diff", () => {
  const diff =
    "+ * Staged files with the most-changed first, each carrying its changed-line\n" +
    "+ * count.\n";

  assert.match(
    findSummaryProblem(
      "Staged files with the most-changed first, each carrying its changed-line count",
      { diff },
    ),
    /copied out of the diff/,
  );
});

test("accepts a summary that names the edit", () => {
  assert.equal(
    findSummaryProblem(
      "sort staged files by churn before rendering the prompt",
      {
        diff: "+  return files.sort(byChurnDescending);\n",
        path: "src/prompt.mjs",
      },
    ),
    null,
  );
});

test("normalizes a summary without changing its meaning", () => {
  assert.equal(
    normalizeSummary("- guard a missing profile."),
    "guard a missing profile",
  );
  assert.equal(normalizeSummary("  two   spaces  "), "two spaces");
  assert.equal(normalizeSummary(""), null);
  assert.equal(normalizeSummary(undefined), null);
  assert.equal(normalizeSummary("x".repeat(300)).length, 120);
});
