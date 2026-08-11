import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_FILENAME = "config.json";

export const DEFAULT_CONFIG = Object.freeze({
  AGENT_API_KEY: "",
  AGENT_MODEL: "",
  AGENT_PROVIDER: "auto",
  "auto-stage-all": false,
  caveman: true,
  "show-scope": true,
  "show-usage-summary": false,
});

const CONFIG_SCHEMA = Object.freeze({
  AGENT_API_KEY: {
    description:
      "API key for OpenAI/Codex, Claude, or DeepSeek. The value is always hidden in command output.",
    secret: true,
    setExample: '"$OPENAI_API_KEY"',
    type: "string",
  },
  AGENT_MODEL: {
    defaultLabel: "<provider default>",
    description:
      "Provider model ID. Leave empty to use the provider's default model.",
    setExample: "gpt-5-mini",
    type: "string",
  },
  AGENT_PROVIDER: {
    description:
      'API provider: "auto", "openai", "codex", "claude", or "deepseek".',
    setExample: "openai",
    type: "enum",
    values: ["auto", "openai", "codex", "claude", "deepseek"],
  },
  "auto-stage-all": {
    description:
      "Stage all changes automatically instead of prompting when augit commit finds none staged.",
    setExample: "true",
    type: "boolean",
  },
  caveman: {
    description:
      'Write the subject and body in caveman style: articles and filler dropped, "<old> -> <new>" for replacements. Identifiers, paths and BREAKING CHANGE notes stay spelled out. Disable for plain English.',
    setExample: "false",
    type: "boolean",
  },
  "show-scope": {
    description:
      'Include a scope in generated subjects, e.g. "fix(cli): ...". Disable for a bare "<type>: <description>" subject.',
    setExample: "false",
    type: "boolean",
  },
  "show-usage-summary": {
    description:
      "Print the API provider, model, token, and timing summary after generating a commit message.",
    setExample: "true",
    type: "boolean",
  },
});

export const configHelp = `augit config

Get or set augit's persisted configuration.

Usage:
  augit config
  augit config list
  augit config get <key>
  augit config set <key> <value>

Keys:
${Object.entries(CONFIG_SCHEMA)
  .map(
    ([key, { description }]) =>
      `  ${key} (default: ${formatDefaultValue(key)})\n    ${description}`,
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
  if (env.AUGIT_CONFIG_DIR) {
    return env.AUGIT_CONFIG_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Preferences", "augit");
  }

  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "augit");
  }

  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "augit");
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
      `Failed to parse augit config at ${path}: ${error.message}`,
    );
  }

  const config = { ...DEFAULT_CONFIG };

  for (const [key, definition] of Object.entries(CONFIG_SCHEMA)) {
    if (
      Object.prototype.hasOwnProperty.call(parsed, key) &&
      isStoredValueValid(parsed[key], definition)
    ) {
      config[key] = parsed[key];
    }
  }

  return config;
}

export async function saveConfig(config, options = {}) {
  const path = options.path || getConfigFilePath(options);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);

  return { path };
}

function assertKnownKey(key) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG_SCHEMA, key)) {
    throw new ConfigCommandUsageError(
      `Unknown config key: ${key}. Known keys: ${Object.keys(CONFIG_SCHEMA).join(", ")}.`,
    );
  }
}

function parseConfigValue(key, rawValue) {
  const definition = CONFIG_SCHEMA[key];
  const value = String(rawValue);

  if (definition.type === "string") {
    return value.trim();
  }

  const normalized = value.toLowerCase();

  if (definition.type === "enum") {
    if (definition.values.includes(normalized)) {
      return normalized;
    }

    throw new ConfigCommandUsageError(
      `Invalid value for ${key}: ${rawValue}. Expected one of: ${definition.values.join(", ")}. Fix it with, for example: \`augit config set ${key} ${definition.setExample}\`.`,
    );
  }

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
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function formatVisibleConfigValue(key, value) {
  const definition = CONFIG_SCHEMA[key];

  if (definition.secret) {
    return value ? "<redacted>" : "<not set>";
  }

  if (definition.defaultLabel && !value) {
    return definition.defaultLabel;
  }

  return formatConfigValue(value);
}

function formatDefaultValue(key) {
  if (CONFIG_SCHEMA[key].defaultLabel) {
    return CONFIG_SCHEMA[key].defaultLabel;
  }

  return formatVisibleConfigValue(key, DEFAULT_CONFIG[key]);
}

function formatConfigLines(config, prefix = "") {
  return Object.keys(CONFIG_SCHEMA)
    .map(
      (key) =>
        `${prefix}${key} = ${formatVisibleConfigValue(key, config[key])}`,
    )
    .join("\n");
}

function formatConfigOverview(config) {
  const updateCommands = Object.entries(CONFIG_SCHEMA)
    .map(
      ([key, definition]) =>
        `  augit config set ${key} ${definition.setExample}`,
    )
    .join("\n");

  return `Current configuration:\n${formatConfigLines(config, "  ")}\n\nUpdate values:\n${updateCommands}\n\nUse \`augit config get <key>\` to read one value or \`augit config --help\` for details.\n`;
}

function isStoredValueValid(value, definition) {
  if (definition.type === "boolean") {
    return typeof value === "boolean";
  }

  if (definition.type === "enum") {
    return typeof value === "string" && definition.values.includes(value);
  }

  return typeof value === "string";
}

export function resolveAgentConfig(
  config = DEFAULT_CONFIG,
  { env = process.env } = {},
) {
  const apiKey = String(env.AGENT_API_KEY || config.AGENT_API_KEY || "").trim();
  const provider = String(env.AGENT_PROVIDER || config.AGENT_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  const model = String(env.AGENT_MODEL || config.AGENT_MODEL || "").trim();

  return {
    apiKey,
    provider,
    ...(model ? { model } : {}),
  };
}

export async function runConfigCommand(
  args = [],
  io = process,
  { load = loadConfig, save = saveConfig } = {},
) {
  const [subcommand, ...rest] = args;

  if (subcommand === undefined) {
    io.stdout.write(formatConfigOverview(await load()));
    return 0;
  }

  if (subcommand === "--help" || subcommand === "-h") {
    io.stdout.write(configHelp);
    return 0;
  }

  if (subcommand === "list") {
    const config = await load();

    io.stdout.write(`${formatConfigLines(config)}\n`);
    return 0;
  }

  if (subcommand === "get") {
    const [key] = rest;

    if (!key) {
      throw new ConfigCommandUsageError("Usage: augit config get <key>");
    }

    assertKnownKey(key);

    const config = await load();

    io.stdout.write(`${formatVisibleConfigValue(key, config[key])}\n`);
    return 0;
  }

  if (subcommand === "set") {
    const [key, rawValue] = rest;

    if (!key || rawValue === undefined) {
      throw new ConfigCommandUsageError(
        "Usage: augit config set <key> <value>",
      );
    }

    assertKnownKey(key);

    const value = parseConfigValue(key, rawValue);
    const config = await load();

    config[key] = value;
    await save(config);

    io.stdout.write(`${key} = ${formatVisibleConfigValue(key, value)}\n`);
    return 0;
  }

  throw new ConfigCommandUsageError(
    `Unknown config subcommand: ${subcommand}. Run augit config --help.`,
  );
}
