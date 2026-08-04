import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LEGACY_MODEL_FILENAME = "Llama-3.2-3B-Instruct-Q4_K_M.gguf";

export function getLegacyModelPath({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  let cacheDirectory;

  if (env.AUGI_CACHE_DIR) {
    cacheDirectory = env.AUGI_CACHE_DIR;
  } else if (platform === "darwin") {
    cacheDirectory = join(home, "Library", "Caches", "augi");
  } else if (platform === "win32") {
    cacheDirectory = join(
      env.LOCALAPPDATA || join(home, "AppData", "Local"),
      "augi",
    );
  } else {
    cacheDirectory = join(env.XDG_CACHE_HOME || join(home, ".cache"), "augi");
  }

  return join(cacheDirectory, "models", LEGACY_MODEL_FILENAME);
}

export async function clearLegacyModel(options = {}) {
  const path = options.path || getLegacyModelPath(options);
  const removed = [];

  for (const artifactPath of [`${path}.part`, `${path}.json`, path]) {
    removed.push(await unlinkIfPresent(artifactPath));
  }

  return { path, cleared: removed.some(Boolean) };
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
