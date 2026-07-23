import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ModelDownloadError,
  ModelUnavailableOfflineError,
  ensureModel,
  getCacheDirectory,
} from "../src/model.mjs";

function fixtureModel(contents) {
  return {
    id: "fixture",
    name: "Fixture",
    filename: "fixture.gguf",
    byteLength: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
    url: "https://example.test/fixture.gguf",
  };
}

test("uses the platform cache directory", () => {
  assert.equal(
    getCacheDirectory({ env: {}, home: "/Users/test", platform: "darwin" }),
    "/Users/test/Library/Caches/gikum",
  );
  assert.equal(
    getCacheDirectory({
      env: { XDG_CACHE_HOME: "/var/cache/test" },
      home: "/home/test",
      platform: "linux",
    }),
    "/var/cache/test/gikum",
  );
  assert.equal(
    getCacheDirectory({
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      home: "C:\\Users\\test",
      platform: "win32",
    }),
    "C:\\Users\\test\\AppData\\Local/gikum",
  );
});

test("downloads, verifies, and reuses a cached model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gikum-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const contents = Buffer.from("tiny verified model");
  const model = fixtureModel(contents);
  const progress = [];
  let requests = 0;
  const fetch = async () => {
    requests += 1;
    return new Response(contents);
  };

  const downloaded = await ensureModel(model, {
    fetch,
    path,
    onProgress: (event) => progress.push(event),
  });
  const cached = await ensureModel(model, { fetch, path, offline: true });

  assert.equal(downloaded.downloaded, true);
  assert.equal(cached.downloaded, false);
  assert.equal(requests, 1);
  assert.deepEqual(await readFile(path), contents);
  assert.deepEqual(progress.at(0), { downloaded: 0, total: contents.length });
  assert.deepEqual(progress.at(-1), {
    downloaded: contents.length,
    total: contents.length,
  });
});

test("rejects a model that fails its integrity check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gikum-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const expected = Buffer.from("expected");
  const model = fixtureModel(expected);

  await assert.rejects(
    ensureModel(model, {
      path,
      fetch: async () => new Response(Buffer.from("tampered")),
    }),
    (error) =>
      error instanceof ModelDownloadError &&
      /integrity check/.test(error.message),
  );

  assert.deepEqual(await readdir(join(directory, "models")), []);
});

test("explains when an uncached model is unavailable offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gikum-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const model = fixtureModel(Buffer.from("fixture"));

  await assert.rejects(
    ensureModel(model, { path, offline: true }),
    (error) =>
      error instanceof ModelUnavailableOfflineError &&
      error.code === "MODEL_UNAVAILABLE_OFFLINE",
  );
});
