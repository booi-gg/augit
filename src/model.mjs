import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import lockfile from "proper-lockfile";

const MODEL_REVISION = "38f6bab61d341b23a6c00226f32c0d6148bf9f43";
const MODEL_FILENAME = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_WAIT_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_LOCK_RETRY_MS = 250;
const DEFAULT_LEGACY_LOCK_GRACE_MS = 2_000;

export const BUILT_IN_MODEL = Object.freeze({
  id: "qwen2.5-coder-1.5b-instruct-q4-k-m",
  name: "Qwen2.5-Coder-1.5B-Instruct Q4_K_M",
  filename: MODEL_FILENAME,
  byteLength: 1_117_320_768,
  sha256: "cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046",
  url:
    "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF" +
    `/resolve/${MODEL_REVISION}/${MODEL_FILENAME}?download=true`,
});

export class ModelUnavailableOfflineError extends Error {
  constructor(path) {
    super(
      "The built-in model has not been downloaded yet. " +
        `Connect to the internet and run gikum once (cache: ${path}).`,
    );
    this.name = "ModelUnavailableOfflineError";
    this.code = "MODEL_UNAVAILABLE_OFFLINE";
  }
}

export class ModelDownloadError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ModelDownloadError";
    this.code = "MODEL_DOWNLOAD_FAILED";
  }
}

export function getCacheDirectory({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (env.GIKUM_CACHE_DIR) {
    return env.GIKUM_CACHE_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Caches", "gikum");
  }

  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "gikum");
  }

  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "gikum");
}

export function getBuiltInModelPath(options = {}) {
  return join(getCacheDirectory(options), "models", BUILT_IN_MODEL.filename);
}

export async function ensureBuiltInModel(options = {}) {
  return ensureModel(BUILT_IN_MODEL, {
    ...options,
    path: options.path || getBuiltInModelPath(options),
  });
}

export async function clearBuiltInModel(options = {}) {
  const path = options.path || getBuiltInModelPath(options);

  await mkdir(dirname(path), { recursive: true });

  const downloadLock = await acquireDownloadLock(
    path,
    `${path}.lock`,
    options.lockOptions,
  );

  try {
    downloadLock.assertOwned();

    const removed = [];

    for (const artifactPath of [`${path}.part`, `${path}.json`, path]) {
      removed.push(await unlinkIfPresent(artifactPath));
    }

    downloadLock.assertOwned();

    return { path, cleared: removed.some(Boolean) };
  } finally {
    await downloadLock.release().catch(() => {});
  }
}

// The model parameter is internal so tests can exercise downloads with tiny fixtures.
// Product callers use ensureBuiltInModel and never choose a model.
export async function ensureModel(
  model,
  {
    fetch: fetchModel = globalThis.fetch,
    offline = false,
    onProgress = () => {},
    path,
    lockOptions = {},
  },
) {
  if (!path) {
    throw new TypeError("A model cache path is required.");
  }

  await mkdir(dirname(path), { recursive: true });

  if (await isCachedModelValid(model, path)) {
    return { model, path, downloaded: false };
  }

  if (offline) {
    throw new ModelUnavailableOfflineError(path);
  }

  if (typeof fetchModel !== "function") {
    throw new ModelDownloadError(
      "This version of Node.js cannot download the built-in model.",
    );
  }

  const lockPath = `${path}.lock`;
  const downloadLock = await acquireDownloadLock(path, lockPath, lockOptions);

  const partialPath = `${path}.part`;

  try {
    if (await isCachedModelValid(model, path)) {
      return { model, path, downloaded: false };
    }

    await rm(partialPath, { force: true });
    await downloadAndVerify(model, partialPath, fetchModel, onProgress);
    downloadLock.assertOwned();
    await rename(partialPath, path);
    await writeVerificationMetadata(model, path);

    return { model, path, downloaded: true };
  } finally {
    await rm(partialPath, { force: true }).catch(() => {});
    await downloadLock.release().catch(() => {});
  }
}

async function acquireDownloadLock(
  path,
  lockPath,
  {
    staleMs = DEFAULT_LOCK_STALE_MS,
    waitMs = DEFAULT_LOCK_WAIT_MS,
    retryMs = DEFAULT_LOCK_RETRY_MS,
    legacyGraceMs = DEFAULT_LEGACY_LOCK_GRACE_MS,
  } = {},
) {
  await clearLegacyFileLock(lockPath, {
    graceMs: legacyGraceMs,
    retryMs,
    waitMs,
  });

  let compromisedError;

  try {
    const release = await lockfile.lock(path, {
      realpath: false,
      lockfilePath: lockPath,
      stale: Math.max(staleMs, 2_000),
      update: Math.max(1_000, Math.floor(Math.max(staleMs, 2_000) / 3)),
      retries: {
        forever: true,
        factor: 1,
        minTimeout: retryMs,
        maxTimeout: retryMs,
        randomize: true,
        maxRetryTime: waitMs,
      },
      onCompromised(error) {
        compromisedError = error;
      },
    });

    return {
      assertOwned() {
        if (compromisedError) {
          throw new ModelDownloadError(
            "The model download lock was lost. Run gikum again to retry.",
            { cause: compromisedError },
          );
        }
      },
      release,
    };
  } catch (cause) {
    throw new ModelDownloadError(
      "Timed out waiting for another built-in model download to finish.",
      { cause },
    );
  }
}

async function clearLegacyFileLock(lockPath, { graceMs, retryMs, waitMs }) {
  const deadline = Date.now() + waitMs;

  while (true) {
    let lockStat;

    try {
      lockStat = await lstat(lockPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }

      throw error;
    }

    if (lockStat.isDirectory()) {
      return;
    }

    if (!lockStat.isFile()) {
      throw new ModelDownloadError(
        `Cannot use the model download lock at ${lockPath}.`,
      );
    }

    const owner = Number.parseInt(
      await readFile(lockPath, "utf8").catch(() => ""),
      10,
    );
    const ownerIsDead = Number.isInteger(owner) && !isProcessAlive(owner);
    const isAbandoned =
      ownerIsDead ||
      (!Number.isInteger(owner) && Date.now() - lockStat.mtimeMs >= graceMs);

    if (isAbandoned) {
      try {
        await unlink(lockPath);
        return;
      } catch (error) {
        if (error.code === "ENOENT") {
          return;
        }

        if (error.code === "EISDIR") {
          return;
        }

        if (error.code === "EPERM") {
          let currentLock;

          try {
            currentLock = await lstat(lockPath);
          } catch (currentError) {
            if (currentError.code === "ENOENT") {
              return;
            }

            throw error;
          }

          if (currentLock.isDirectory()) {
            return;
          }
        }

        throw error;
      }
    }

    if (Date.now() >= deadline) {
      throw new ModelDownloadError(
        "Timed out waiting for another built-in model download to finish.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function downloadAndVerify(model, partialPath, fetchModel, onProgress) {
  let response;

  try {
    response = await fetchModel(model.url, { redirect: "follow" });
  } catch (cause) {
    throw new ModelDownloadError(
      "Could not download the built-in model. Check your internet connection and retry.",
      { cause },
    );
  }

  if (!response.ok) {
    throw new ModelDownloadError(
      `Could not download the built-in model (HTTP ${response.status}). Retry later.`,
    );
  }

  if (!response.body) {
    throw new ModelDownloadError(
      "The model download returned no data. Retry later.",
    );
  }

  const hash = createHash("sha256");
  let downloaded = 0;
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;
      hash.update(chunk);
      onProgress({ downloaded, total: model.byteLength });
      callback(null, chunk);
    },
  });

  onProgress({ downloaded: 0, total: model.byteLength });

  try {
    const body =
      typeof response.body.getReader === "function"
        ? Readable.fromWeb(response.body)
        : response.body;

    await pipeline(
      body,
      meter,
      createWriteStream(partialPath, { flags: "wx" }),
    );
  } catch (cause) {
    if (cause instanceof ModelDownloadError) {
      throw cause;
    }

    throw new ModelDownloadError(
      "The built-in model download was interrupted. Run gikum again to retry.",
      { cause },
    );
  }

  if (downloaded !== model.byteLength) {
    throw new ModelDownloadError(
      `The model download was incomplete (received ${downloaded} of ${model.byteLength} bytes).`,
    );
  }

  const digest = hash.digest("hex");

  if (digest !== model.sha256) {
    throw new ModelDownloadError(
      "The model download failed its integrity check. Run gikum again to retry.",
    );
  }
}

async function isCachedModelValid(
  model,
  path,
  { verifyUntracked = true } = {},
) {
  let file;

  try {
    file = await stat(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  if (!file.isFile() || file.size !== BigInt(model.byteLength)) {
    return false;
  }

  const metadata = await readVerificationMetadata(path);
  const initialFingerprint = fingerprintStat(file);

  if (
    metadata?.sha256 === model.sha256 &&
    metadata?.byteLength === model.byteLength &&
    fingerprintsEqual(metadata.file, initialFingerprint)
  ) {
    return true;
  }

  if (!verifyUntracked) {
    return false;
  }

  const digest = await hashFile(path);

  if (digest !== model.sha256) {
    return false;
  }

  let finalFile;

  try {
    finalFile = await stat(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  const finalFingerprint = fingerprintStat(finalFile);

  if (!fingerprintsEqual(initialFingerprint, finalFingerprint)) {
    return false;
  }

  await writeVerificationMetadata(model, path, finalFingerprint);
  return true;
}

async function hashFile(path) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function readVerificationMetadata(path) {
  try {
    return JSON.parse(await readFile(`${path}.json`, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

function fingerprintStat(file) {
  return {
    size: file.size.toString(),
    mtimeNs: file.mtimeNs.toString(),
    ctimeNs: file.ctimeNs.toString(),
    ino: file.ino.toString(),
  };
}

function fingerprintsEqual(left, right) {
  return (
    left?.size === right?.size &&
    left?.mtimeNs === right?.mtimeNs &&
    left?.ctimeNs === right?.ctimeNs &&
    left?.ino === right?.ino
  );
}

async function writeVerificationMetadata(model, path, fileFingerprint) {
  const metadataPath = `${path}.json`;
  const temporaryPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  const file =
    fileFingerprint || fingerprintStat(await stat(path, { bigint: true }));
  const metadata = {
    model: model.id,
    byteLength: model.byteLength,
    sha256: model.sha256,
    source: model.url,
    file,
  };

  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await rename(temporaryPath, metadataPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}
