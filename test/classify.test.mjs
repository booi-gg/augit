import assert from "node:assert/strict";
import { test } from "node:test";

import { extractKeyConcepts, inferRequiredType } from "../src/classify.mjs";

test("classifies unambiguous documentation, test, and CI changes", () => {
  assert.equal(
    inferRequiredType({
      files: [{ status: "M", path: "README.md" }],
      diff: "",
    }),
    "docs",
  );
  assert.equal(
    inferRequiredType({
      files: [{ status: "M", path: "test/model.test.mjs" }],
      diff: "",
    }),
    "test",
  );
  assert.equal(
    inferRequiredType({
      files: [{ status: "M", path: ".github/workflows/ci.yml" }],
      diff: "",
    }),
    "ci",
  );
});

test("classifies added CLI flags as features", () => {
  assert.equal(
    inferRequiredType({
      files: [{ status: "M", path: "src/cli.mjs" }],
      diff: '+const dryRun = args.includes("--dry-run");\n',
    }),
    "feat",
  );
});

test("classifies moved code as a refactor", () => {
  assert.equal(
    inferRequiredType({
      files: [
        { status: "M", path: "src/index.mjs" },
        { status: "A", path: "src/parser.mjs" },
      ],
      diff:
        "-  const parsed = JSON.parse(value);\n" +
        "-  return validate(parsed);\n" +
        "+  const parsed = JSON.parse(value);\n" +
        "+  return validate(parsed);\n",
    }),
    "refactor",
  );
});

test("leaves ambiguous source changes to the model", () => {
  assert.equal(
    inferRequiredType({
      files: [{ status: "M", path: "src/profile.mjs" }],
      diff: "+if (!profile) return null;\n",
    }),
    undefined,
  );
});

test("classifies a defensive guard around existing access as a fix", () => {
  const context = {
    files: [{ status: "M", path: "src/profile.mjs" }],
    diff:
      "-return user.profile.name;\n" +
      '+if (!user?.profile) return "Anonymous";\n' +
      "+return user.profile.name;\n",
  };

  assert.equal(inferRequiredType(context), "fix");
  assert.deepEqual(extractKeyConcepts(context), ["missing profile"]);
});

test("extracts concise semantic signals from added content", () => {
  assert.deepEqual(
    extractKeyConcepts({
      diff:
        '+const dryRun = args.includes("--dry-run");\n' +
        '+test("coordinates concurrent downloads", async () => {\n' +
        "+  await Promise.all(downloads);\n" +
        "+  await rm(file);\n" +
        "+});\n",
    }),
    [
      "--dry-run",
      "coordinates concurrent downloads",
      "concurrency",
      "deletion",
    ],
  );
});

test("extracts the module name from an added source file", () => {
  assert.deepEqual(
    extractKeyConcepts({
      files: [{ status: "A", path: "src/parser.mjs" }],
      diff: "+export function parseConfig() {}\n",
    }),
    ["parser"],
  );
});
