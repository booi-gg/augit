import assert from "node:assert/strict";
import { test } from "node:test";

import {
  InvalidModelOutputError,
  normalizeCommitMessage,
} from "../src/output.mjs";

test("normalizes a structured Conventional Commit response", () => {
  const result = normalizeCommitMessage({
    subject: "Feat(Core): add local generation.",
    body: "  Keep source diffs on the developer machine.  ",
  });

  assert.deepEqual(result, {
    subject: "feat(core): add local generation",
    body: "Keep source diffs on the developer machine.",
    message:
      "feat(core): add local generation\n\n" +
      "Keep source diffs on the developer machine.",
  });
});

test("accepts JSON text from an alternate runtime adapter", () => {
  const result = normalizeCommitMessage(
    '{"subject":"fix: handle empty diffs","body":""}',
  );

  assert.equal(result.message, "fix: handle empty diffs");
});

test("rejects non-Conventional subjects", () => {
  assert.throws(
    () =>
      normalizeCommitMessage({
        subject: "Updated some files",
        body: "",
      }),
    (error) =>
      error instanceof InvalidModelOutputError &&
      /Conventional Commit/.test(error.message),
  );
});

test("rejects subjects longer than 72 characters", () => {
  assert.throws(
    () =>
      normalizeCommitMessage({
        subject: `feat: ${"x".repeat(70)}`,
        body: "",
      }),
    (error) =>
      error instanceof InvalidModelOutputError &&
      /72 characters/.test(error.message),
  );
});

test("rejects test boilerplate and vague descriptions", () => {
  assert.throws(
    () =>
      normalizeCommitMessage({
        subject: "test: add test for concurrent downloads",
        body: "",
      }),
    InvalidModelOutputError,
  );
  assert.throws(
    () =>
      normalizeCommitMessage({
        subject: "chore: update files",
        body: "",
      }),
    InvalidModelOutputError,
  );
});

test("enforces an unambiguous type selected from repository structure", () => {
  const result = normalizeCommitMessage(
    {
      subject: "feat(readme): add installation instructions",
      body: "",
    },
    { requiredType: "docs" },
  );

  assert.equal(result.message, "docs(readme): add installation instructions");
});

test("normalizes path-like and redundant scopes", () => {
  assert.equal(
    normalizeCommitMessage({
      subject: "fix(src/profile.mjs): handle missing profiles",
      body: "",
    }).message,
    "fix(profile): handle missing profiles",
  );
  assert.equal(
    normalizeCommitMessage({
      subject: "test(test): cover concurrent downloads",
      body: "",
    }).message,
    "test: cover concurrent downloads",
  );
});
