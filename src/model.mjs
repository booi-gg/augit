import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MODEL_REVISION = "38f6bab61d341b23a6c00226f32c0d6148bf9f43";
const MODEL_FILENAME = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";

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
    return join(
      env.LOCALAPPDATA || join(home, "AppData", "Local"),
      "gikum",
    );
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

// The model parameter is internal so tests can exercise downloads with tiny fixtures.
// Product callers use ensureBuiltInModel and never choose a model.
export async function ensureModel(
  model,
  {
    fetch: fetchModel = globalThis.fetch,
    offline = false,
    onProgress = () => {},
    path,
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
  const lock = await acquireDownloadLock(model, path, lockPath);

  if (!lock) {
    return { model, path, downloaded: false };
  }

  const partialPath = `${path}.part`;

  try {
    if (await isCachedModelValid(model, path)) {
      return { model, path, downloaded: false };
    }

    await rm(partialPath, { force: true });
    await downloadAndVerify(model, partialPath, fetchModel, onProgress);
    await rename(partialPath, path);
    await writeVerificationMetadata(model, path);

    return { model, path, downloaded: true };
  } finally {
    await rm(partialPath, { force: true }).catch(() => {});
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

async function acquireDownloadLock(model, path, lockPath) {
  while (true) {
    try {
      const lock = await open(lockPath, "wx");
      await lock.writeFile(`${process.pid}\n`);
      return lock;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }

    if (await isCachedModelValid(model, path, { verifyUntracked: false })) {
      return null;
    }

    const owner = Number.parseInt(await readFile(lockPath, "utf8").catch(() => ""));

    if (Number.isInteger(owner) && !isProcessAlive(owner)) {
      await rm(lockPath, { force: true });
      await rm(`${path}.part`, { force: true });
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
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
    file = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  if (!file.isFile() || file.size !== model.byteLength) {
    return false;
  }

  const metadata = await readVerificationMetadata(path);

  if (
    metadata?.sha256 === model.sha256 &&
    metadata?.byteLength === model.byteLength
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

  await writeVerificationMetadata(model, path);
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

async function writeVerificationMetadata(model, path) {
  const metadataPath = `${path}.json`;
  const temporaryPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  const metadata = {
    model: model.id,
    byteLength: model.byteLength,
    sha256: model.sha256,
    source: model.url,
  };

  await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(temporaryPath, metadataPath);
}
