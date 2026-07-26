import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ModelDownloadError,
  ModelUnavailableOfflineError,
  clearBuiltInModel,
  ensureModel,
  getCacheDirectory,
  inspectModel,
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
    "/Users/test/Library/Caches/augi",
  );
  assert.equal(
    getCacheDirectory({
      env: { XDG_CACHE_HOME: "/var/cache/test" },
      home: "/home/test",
      platform: "linux",
    }),
    "/var/cache/test/augi",
  );
  assert.equal(
    getCacheDirectory({
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      home: "C:\\Users\\test",
      platform: "win32",
    }),
    join("C:\\Users\\test\\AppData\\Local", "augi"),
  );
});

test("downloads, verifies, and reuses a cached model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
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

test("inspects missing, verified, and invalid model caches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const contents = Buffer.from("tiny verified model");
  const model = fixtureModel(contents);

  const missing = await inspectModel(model, { path });

  await ensureModel(model, {
    path,
    fetch: async () => new Response(contents),
  });

  const ready = await inspectModel(model, { path });

  await writeFile(path, Buffer.from("tampered model data"));

  const invalid = await inspectModel(model, { path });

  assert.deepEqual(missing, {
    model,
    path,
    state: "missing",
    file: null,
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.file.byteLength, contents.length);
  assert.match(ready.file.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(invalid.state, "invalid");
});

test("clears the cached model and its download artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");

  await mkdir(join(directory, "models"), { recursive: true });
  await writeFile(path, "model");
  await writeFile(`${path}.json`, "metadata");
  await writeFile(`${path}.part`, "partial");

  const cleared = await clearBuiltInModel({ path });
  const alreadyClear = await clearBuiltInModel({ path });

  assert.deepEqual(cleared, { path, cleared: true });
  assert.deepEqual(alreadyClear, { path, cleared: false });
  assert.deepEqual(await readdir(join(directory, "models")), []);
});

test("rejects a model that fails its integrity check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
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
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const model = fixtureModel(Buffer.from("fixture"));

  await assert.rejects(
    ensureModel(model, { path, offline: true }),
    (error) =>
      error instanceof ModelUnavailableOfflineError &&
      error.code === "MODEL_UNAVAILABLE_OFFLINE",
  );
});

test("does not trust verification metadata after the model file changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const contents = Buffer.from("valid");
  const model = fixtureModel(contents);

  await ensureModel(model, {
    path,
    fetch: async () => new Response(contents),
  });
  await writeFile(path, Buffer.from("evil!"));

  await assert.rejects(
    ensureModel(model, { path, offline: true }),
    (error) => error instanceof ModelUnavailableOfflineError,
  );
});

test("recovers an abandoned legacy lock instead of waiting forever", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const contents = Buffer.from("fixture");
  const model = fixtureModel(contents);
  const lockPath = `${path}.lock`;

  await mkdir(join(directory, "models"), { recursive: true });
  await writeFile(lockPath, "");
  await utimes(lockPath, new Date(0), new Date(0));

  const result = await ensureModel(model, {
    path,
    fetch: async () => new Response(contents),
    lockOptions: { legacyGraceMs: 0, waitMs: 200 },
  });

  assert.equal(result.downloaded, true);
  assert.deepEqual(await readFile(path), contents);
});

test("coordinates concurrent downloads of the same model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const contents = Buffer.from("fixture");
  const model = fixtureModel(contents);
  let requests = 0;
  const fetch = async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return new Response(contents);
  };

  const results = await Promise.all([
    ensureModel(model, { path, fetch }),
    ensureModel(model, { path, fetch }),
  ]);

  assert.equal(requests, 1);
  assert.equal(results.filter((result) => result.downloaded).length, 1);
});

test("waits for an active download before clearing its model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augi-test-"));
  const path = join(directory, "models", "fixture.gguf");
  const contents = Buffer.from("fixture");
  const model = fixtureModel(contents);
  let releaseFetch;
  let signalFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    signalFetchStarted = resolve;
  });
  const fetchReleased = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const download = ensureModel(model, {
    path,
    async fetch() {
      signalFetchStarted();
      await fetchReleased;
      return new Response(contents);
    },
  });

  await fetchStarted;

  const clearing = clearBuiltInModel({
    path,
    lockOptions: { retryMs: 5, waitMs: 1_000 },
  });

  releaseFetch();

  const [downloaded, cleared] = await Promise.all([download, clearing]);

  assert.equal(downloaded.downloaded, true);
  assert.deepEqual(cleared, { path, cleared: true });
  assert.deepEqual(await readdir(join(directory, "models")), []);
});
