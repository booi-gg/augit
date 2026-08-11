import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCommitPrompt,
  buildSummaryCommitPrompt,
  promptInstructions,
} from "../src/prompt.mjs";

const CONTEXT = {
  diff: [
    "diff --git a/package.json b/package.json",
    '-  "lint": "eslint ."',
    '+  "lint": "biome check"',
  ].join("\n"),
  files: [{ path: "package.json" }],
  recentSubjects: [],
  repository: "augit",
};

describe("caveman style rules", () => {
  it("are in the commit prompt by default", () => {
    const prompt = buildCommitPrompt(CONTEXT);

    assert.match(prompt, /Write like smart caveman/);
    assert.match(prompt, /Drop articles a, an, the/);
  });

  it("are left out when caveman is off", () => {
    const prompt = buildCommitPrompt(CONTEXT, { caveman: false });

    assert.doesNotMatch(prompt, /caveman/i);
    // The rest of the prompt survives the switch.
    assert.match(prompt, /^SUBJECT$/m);
    assert.match(prompt, /^BODY$/m);
  });

  it("reach the summary prompt too", () => {
    const summaries = [
      { changedLines: 4, path: "package.json", summary: "swap lint runner" },
    ];

    assert.match(
      buildSummaryCommitPrompt({ repository: "augit", summaries }),
      /Write like smart caveman/,
    );
    assert.doesNotMatch(
      buildSummaryCommitPrompt(
        { repository: "augit", summaries },
        { caveman: false },
      ),
      /caveman/i,
    );
  });

  // The rules are the one text an answer may never quote, and
  // isCopiedFromInstructions only sees what promptInstructions returns. A rule
  // added below the evidence heading would be invisible to that check.
  it("sit in the rule text, not the evidence", () => {
    const instructions = promptInstructions(buildCommitPrompt(CONTEXT));

    assert.match(instructions, /Write like smart caveman/);
  });

  it("keep BREAKING CHANGE notes out of the compression", () => {
    assert.match(buildCommitPrompt(CONTEXT), /BREAKING CHANGE line/);
  });
});
