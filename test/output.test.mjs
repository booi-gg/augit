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

test("targets 50 characters and enforces a 72-character ceiling", () => {
  assert.equal(
    normalizeCommitMessage({
      subject: `feat: ${"x".repeat(66)}`,
      body: "",
    }).subject.length,
    72,
  );

  assert.throws(
    () =>
      normalizeCommitMessage({
        subject: `feat: ${"x".repeat(67)}`,
        body: "",
      }),
    (error) =>
      error instanceof InvalidModelOutputError &&
      /72 characters/.test(error.message),
  );
});

test("does not truncate exact identifiers to meet the 50-character target", () => {
  const subject = "feat(package): update package name to @booi-gg/gitkum";

  assert.equal(normalizeCommitMessage({ subject, body: "" }).subject, subject);
});

test("rejects non-imperative subject descriptions", () => {
  assert.throws(
    () =>
      normalizeCommitMessage({
        subject: "feat(cli): adds color to commit reviews",
        body: "",
      }),
    (error) =>
      error instanceof InvalidModelOutputError &&
      /imperative verb/.test(error.message),
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

test("drops the scope entirely when scopes are disabled", () => {
  const result = normalizeCommitMessage(
    {
      subject: "fix(cli): handle missing profiles",
      body: "",
    },
    { allowScope: false },
  );

  assert.equal(result.subject, "fix: handle missing profiles");
});

test("drops a boilerplate body that paraphrases the subject", () => {
  const result = normalizeCommitMessage({
    subject: "build(package): rename to @booi-gg/gitkum",
    body:
      "The package has been renamed to @booi-gg/gitkum to better reflect " +
      "the project's purpose and scope.",
  });

  assert.deepEqual(result, {
    subject: "build(package): rename to @booi-gg/gitkum",
    body: "",
    message: "build(package): rename to @booi-gg/gitkum",
  });
});

test("drops verbose boilerplate around a focused change", () => {
  const result = normalizeCommitMessage({
    subject: "feat(package): update package name to @booi-gg/gitkum",
    body:
      "This commit updates the package name from 'gitkum' to " +
      "'@booi-gg/gitkum' to reflect the new project name. The change is " +
      "straightforward and does not introduce any breaking changes.",
  });

  assert.equal(result.body, "");
  assert.equal(
    result.message,
    "feat(package): update package name to @booi-gg/gitkum",
  );
});

test("keeps concrete body context that is absent from the subject", () => {
  const result = normalizeCommitMessage({
    subject: "build(package): rename to @booi-gg/gitkum",
    body: "Existing installs must update imports to use the scoped package.",
  });

  assert.equal(
    result.body,
    "Existing installs must update imports to use the scoped package.",
  );
});

test("wraps useful body text at 72 characters", () => {
  const result = normalizeCommitMessage({
    subject: "fix(cache): recover stale model downloads",
    body:
      "Heartbeat-backed locks let another process recover when a downloader " +
      "exits before releasing the shared model cache lock.",
  });

  assert.ok(result.body.includes("\n"));
  assert.ok(result.body.split("\n").every((line) => line.length <= 72));
});
