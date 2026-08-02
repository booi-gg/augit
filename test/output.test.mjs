import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCopiedFromInstructions,
  namesUnstagedFile,
  normalizeCommitMessage,
} from "../src/output.mjs";
import { buildCommitPrompt, promptInstructions } from "../src/prompt.mjs";

const FILES = [{ path: "package.json" }, { path: "src/app/page.tsx" }];
const DIFF = [
  "diff --git a/package.json b/package.json",
  '-  "lint": "eslint ."',
  '+  "lint": "biome check"',
].join("\n");
const INSTRUCTIONS = promptInstructions(
  buildCommitPrompt({
    diff: DIFF,
    files: FILES,
    recentSubjects: [],
    repository: "augi",
  }),
);
const EVIDENCE = {
  diff: DIFF,
  files: FILES,
  instructions: INSTRUCTIONS,
  keyConcepts: [],
  repository: "augi",
};

describe("isCopiedFromInstructions", () => {
  it("catches a rule line returned as the answer", () => {
    assert.equal(
      isCopiedFromInstructions(
        "rank, describe top one only. Never join two with a comma",
        INSTRUCTIONS,
      ),
      true,
    );
  });

  it("ignores punctuation and filler the model dropped", () => {
    assert.equal(
      isCopiedFromInstructions(
        "Many changes, rank, describe the top one only",
        INSTRUCTIONS,
      ),
      true,
    );
  });

  it("keeps a description that only shares short phrases", () => {
    assert.equal(
      isCopiedFromInstructions("swap eslint for biome check", INSTRUCTIONS),
      false,
    );
    assert.equal(
      isCopiedFromInstructions("name the new lint command", INSTRUCTIONS),
      false,
    );
  });

  it("reports nothing when there are no instructions", () => {
    assert.equal(
      isCopiedFromInstructions("rank describe top one only", ""),
      false,
    );
  });
});

describe("namesUnstagedFile", () => {
  it("names a file the change never touched", () => {
    assert.equal(namesUnstagedFile("update README.md", FILES), "readme.md");
  });

  it("accepts a staged path by any of its names", () => {
    assert.equal(namesUnstagedFile("drop the loader from page.tsx", FILES), "");
    assert.equal(
      namesUnstagedFile("drop the loader from src/app/page.tsx", FILES),
      "",
    );
  });

  it("accepts a directory that holds a staged file", () => {
    assert.equal(namesUnstagedFile("move the loader into src/app", FILES), "");
  });

  it("leaves words that only look like paths alone", () => {
    assert.equal(namesUnstagedFile("raise node.js floor to 22", FILES), "");
    assert.equal(namesUnstagedFile("bump the parser to 1.5", FILES), "");
  });

  it("checks nothing when no file list is available", () => {
    assert.equal(namesUnstagedFile("update README.md", []), "");
  });
});

describe("normalizeCommitMessage grounding", () => {
  it("rejects the subject that names an unstaged file", () => {
    assert.throws(
      () =>
        normalizeCommitMessage(
          { subject: "docs: update README.md", body: "" },
          { evidence: EVIDENCE },
        ),
      /not one of the staged files/,
    );
  });

  it("rejects a subject copied out of the rules", () => {
    assert.throws(
      () =>
        normalizeCommitMessage(
          { subject: "chore(package): rank, describe top one only", body: "" },
          { evidence: EVIDENCE },
        ),
      /copied out of these rules/,
    );
  });

  it("drops a body copied out of the rules", () => {
    const { body, message } = normalizeCommitMessage(
      {
        subject: "build(package): swap eslint for biome check",
        body: "Many changes, rank, describe top one only. Rest belong in body.",
      },
      { evidence: EVIDENCE },
    );

    assert.equal(body, "");
    assert.equal(message, "build(package): swap eslint for biome check");
  });

  it("drops a body line naming a file that was never staged", () => {
    const { body } = normalizeCommitMessage(
      {
        subject: "build(package): swap eslint for biome check",
        body: "- drop the rules from .eslintrc.json",
      },
      { evidence: EVIDENCE },
    );

    assert.equal(body, "");
  });

  it("keeps a message built from the staged files", () => {
    const { message } = normalizeCommitMessage(
      {
        subject: "build(package): swap eslint for biome check",
        body: "- drop the unused loader from src/app/page.tsx",
      },
      { evidence: EVIDENCE },
    );

    assert.equal(
      message,
      "build(package): swap eslint for biome check\n\n" +
        "- drop the unused loader from src/app/page.tsx",
    );
  });

  it("stands down on an unstaged path when the file list was cut", () => {
    const { message } = normalizeCommitMessage(
      { subject: "docs: document the pre-push hook in README.md", body: "" },
      { evidence: { ...EVIDENCE, filesTruncated: true } },
    );

    assert.equal(message, "docs: document the pre-push hook in README.md");
  });
});
