import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { clearLegacyModel, getLegacyModelPath } from "../src/model-cache.mjs";

test("resolves the legacy model from the former cache locations", () => {
  assert.equal(
    getLegacyModelPath({ env: {}, home: "/Users/test", platform: "darwin" }),
    "/Users/test/Library/Caches/augi/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  );
  assert.equal(
    getLegacyModelPath({
      env: { XDG_CACHE_HOME: "/var/cache/test" },
      home: "/home/test",
      platform: "linux",
    }),
    "/var/cache/test/augi/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  );
  assert.equal(
    getLegacyModelPath({
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      home: "C:\\Users\\test",
      platform: "win32",
    }),
    join(
      "C:\\Users\\test\\AppData\\Local",
      "augi",
      "models",
      "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    ),
  );
  assert.equal(
    getLegacyModelPath({
      env: { AUGI_CACHE_DIR: "/custom/cache" },
      home: "/Users/test",
      platform: "darwin",
    }),
    "/custom/cache/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  );
});

test("clears the legacy model and its download artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-model-cache-test-"));
  const path = join(directory, "models", "legacy.gguf");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "model");
  await writeFile(`${path}.json`, "metadata");
  await writeFile(`${path}.part`, "partial download");

  assert.deepEqual(await clearLegacyModel({ path }), { path, cleared: true });
  assert.deepEqual(await readdir(dirname(path)), []);
  assert.deepEqual(await clearLegacyModel({ path }), { path, cleared: false });
});
