import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_FILENAME = "config.json";

export const DEFAULT_CONFIG = Object.freeze({
  autoStageAll: false,
  showUsageSummary: false,
});

const CONFIG_SCHEMA = Object.freeze({
  autoStageAll: {
    description:
      "Stage all changes automatically instead of prompting when gitkum commit finds none staged.",
  },
  showUsageSummary: {
    description:
      "Print the local model's token, CPU, and GPU usage summary after generating a commit message.",
  },
});

export const configHelp = `gitkum config

Get or set gitkum's persisted configuration.

Usage:
  gitkum config list
  gitkum config get <key>
  gitkum config set <key> <true|false>

Keys:
${Object.entries(CONFIG_SCHEMA)
  .map(
    ([key, { description }]) =>
      `  ${key} (default: ${DEFAULT_CONFIG[key]})\n    ${description}`,
  )
  .join("\n")}
`;

export class ConfigCommandUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigCommandUsageError";
    this.code = "INVALID_CONFIG_OPTION";
  }
}

export function getConfigDirectory({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (env.GIKUM_CONFIG_DIR) {
    return env.GIKUM_CONFIG_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Preferences", "gikum");
  }

  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "gikum");
  }

  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "gikum");
}

export function getConfigFilePath(options = {}) {
  return join(getConfigDirectory(options), CONFIG_FILENAME);
}

export async function loadConfig(options = {}) {
  const path = options.path || getConfigFilePath(options);
  let raw;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }

    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse gitkum config at ${path}: ${error.message}`,
    );
  }

  const config = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(CONFIG_SCHEMA)) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      config[key] = Boolean(parsed[key]);
    }
  }

  return config;
}

export async function saveConfig(config, options = {}) {
  const path = options.path || getConfigFilePath(options);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return { path };
}

function assertKnownKey(key) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG_SCHEMA, key)) {
    throw new ConfigCommandUsageError(
      `Unknown config key: ${key}. Known keys: ${Object.keys(CONFIG_SCHEMA).join(", ")}.`,
    );
  }
}

function parseBooleanValue(key, rawValue) {
  const normalized = String(rawValue).toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new ConfigCommandUsageError(
    `Invalid value for ${key}: ${rawValue}. Expected true or false.`,
  );
}

function formatConfigValue(value) {
  return value ? "true" : "false";
}

export async function runConfigCommand(
  args = [],
  io = process,
  { load = loadConfig, save = saveConfig } = {},
) {
  const [subcommand, ...rest] = args;

  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    io.stdout.write(configHelp);
    return 0;
  }

  if (subcommand === "list") {
    const config = await load();

    io.stdout.write(
      `${Object.keys(CONFIG_SCHEMA)
        .map((key) => `${key} = ${formatConfigValue(config[key])}`)
        .join("\n")}\n`,
    );
    return 0;
  }

  if (subcommand === "get") {
    const [key] = rest;

    if (!key) {
      throw new ConfigCommandUsageError("Usage: gitkum config get <key>");
    }

    assertKnownKey(key);

    const config = await load();

    io.stdout.write(`${formatConfigValue(config[key])}\n`);
    return 0;
  }

  if (subcommand === "set") {
    const [key, rawValue] = rest;

    if (!key || rawValue === undefined) {
      throw new ConfigCommandUsageError(
        "Usage: gitkum config set <key> <true|false>",
      );
    }

    assertKnownKey(key);

    const value = parseBooleanValue(key, rawValue);
    const config = await load();

    config[key] = value;
    await save(config);

    io.stdout.write(`${key} = ${formatConfigValue(value)}\n`);
    return 0;
  }

  throw new ConfigCommandUsageError(
    `Unknown config subcommand: ${subcommand}. Run gitkum config --help.`,
  );
}
