import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/chill-commit.mjs", import.meta.url));

test("prints help with no arguments", () => {
  const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Generate concise Git commit messages/);
});

test("prints the package version", () => {
  const result = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "0.0.0\n");
});
