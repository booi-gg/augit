import assert from "node:assert/strict";
import { test } from "node:test";

import { assembleCommitFromSummaries } from "../src/assemble.mjs";
import {
  MAX_BODY_LENGTH,
  MAX_BODY_LINE_LENGTH,
  MAX_SUBJECT_LENGTH,
  normalizeCommitMessage,
} from "../src/output.mjs";

const summaries = [
  {
    path: "src/summarize.mjs",
    changedLines: 297,
    summary: "Added a summary pass that reads each staged file on its own",
  },
  {
    path: "src/prompt.mjs",
    changedLines: 300,
    summary: "Replaced the byte-prefix diff cut with a per-file budget",
  },
  { path: "src/broken.mjs", changedLines: 120, summary: null },
  {
    path: "package.json",
    changedLines: 3,
    summary: "Added the widget dependency",
  },
];

test("headlines the largest change, not the first or smallest", () => {
  const result = assembleCommitFromSummaries(summaries);

  assert.match(result.subject, /per-file budget|byte-prefix/);
  assert.doesNotMatch(result.subject, /widget/);
});

test("keeps every other readable task in the body", () => {
  const result = assembleCommitFromSummaries(summaries);

  assert.match(result.body, /summary pass/);
  assert.match(result.body, /widget/);
});

test("never invents a task for a file it could not read", () => {
  const result = assembleCommitFromSummaries(summaries);

  assert.doesNotMatch(result.message, /broken/);
});

test("returns null when no summary survived validation", () => {
  assert.equal(
    assembleCommitFromSummaries([
      { path: "src/a.mjs", changedLines: 10, summary: null },
    ]),
    null,
  );
  assert.equal(assembleCommitFromSummaries([]), null);
});

test("respects the subject and body limits", () => {
  const result = assembleCommitFromSummaries([
    {
      path: "src/verbose.mjs",
      changedLines: 900,
      summary:
        "Added a new feature to the summarize.mjs file, which now reads every staged file",
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      path: `src/file${index}.mjs`,
      changedLines: 100 - index,
      summary: `Removed the --flag-number-${index} option because it is no longer read anywhere`,
    })),
  ]);

  assert.ok(
    result.subject.length <= MAX_SUBJECT_LENGTH,
    `subject is ${result.subject.length} chars`,
  );
  assert.ok(result.body.length <= MAX_BODY_LENGTH);

  for (const line of result.body.split("\n")) {
    assert.ok(
      line.length <= MAX_BODY_LINE_LENGTH,
      `body line is ${line.length} chars: ${line}`,
    );
  }
});

test("does not leave a shortened subject hanging mid-clause", () => {
  const result = assembleCommitFromSummaries([
    {
      path: "src/verbose.mjs",
      changedLines: 900,
      summary:
        "Replaced the byte-prefix diff cut with a shared per-file budget, so that every staged file stays visible",
    },
  ]);

  assert.ok(result.subject.length <= MAX_SUBJECT_LENGTH);
  assert.doesNotMatch(result.subject, /\b(?:which|now|the|and|to|for|is)$/);
});

test("skips a headline that shortening has emptied of meaning", () => {
  const vacuous = {
    path: "src/verbose.mjs",
    changedLines: 900,
    summary:
      "Added a new feature to the verbose.mjs file, which now ranks every staged task by churn",
  };

  // Alone it leaves nothing to say, because the cut removes the only substance.
  assert.equal(assembleCommitFromSummaries([vacuous]), null);

  // Alongside a concrete change, the concrete one becomes the headline.
  const result = assembleCommitFromSummaries([
    vacuous,
    {
      path: "src/prompt.mjs",
      changedLines: 300,
      summary: "Replaced the byte-prefix diff cut with a per-file budget",
    },
  ]);

  assert.match(result.subject, /per-file budget/);
});

test("produces a message the output validator accepts", () => {
  const result = assembleCommitFromSummaries(summaries);

  assert.doesNotThrow(() =>
    normalizeCommitMessage(
      { subject: result.subject, body: result.body },
      {
        evidence: {
          diff: "+const widget = 1;\n",
          files: [{ status: "M", path: "src/prompt.mjs" }],
        },
      },
    ),
  );
});

test("uses a verifiable type from the file list", () => {
  const tests = assembleCommitFromSummaries([
    {
      path: "test/output.test.mjs",
      changedLines: 40,
      summary: "Covered a body that only claims a benefit",
    },
  ]);
  const build = assembleCommitFromSummaries([
    {
      path: "package.json",
      changedLines: 3,
      summary: "Added the widget dependency",
    },
  ]);

  assert.match(tests.subject, /^test/);
  assert.match(build.subject, /^build/);
});

test("drops the scope when scopes are disabled", () => {
  const result = assembleCommitFromSummaries(summaries, { allowScope: false });

  assert.doesNotMatch(result.subject, /\(/);
});
