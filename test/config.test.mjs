import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ConfigCommandUsageError,
  DEFAULT_CONFIG,
  getConfigDirectory,
  loadConfig,
  resolveAgentConfig,
  runConfigCommand,
  saveConfig,
} from "../src/config.mjs";

function fixtureIo() {
  const state = { stderr: "", stdout: "" };
  const io = {
    stdout: { write: (value) => (state.stdout += value) },
    stderr: { write: (value) => (state.stderr += value) },
  };

  return { io, state };
}

test("uses the platform config directory", () => {
  assert.equal(
    getConfigDirectory({ env: {}, home: "/Users/test", platform: "darwin" }),
    "/Users/test/Library/Preferences/augit",
  );
  assert.equal(
    getConfigDirectory({
      env: { XDG_CONFIG_HOME: "/etc/xdg/test" },
      home: "/home/test",
      platform: "linux",
    }),
    "/etc/xdg/test/augit",
  );
  assert.equal(
    getConfigDirectory({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      home: "C:\\Users\\test",
      platform: "win32",
    }),
    join("C:\\Users\\test\\AppData\\Roaming", "augit"),
  );
  assert.equal(
    getConfigDirectory({
      env: { AUGIT_CONFIG_DIR: "/custom/config" },
      home: "/Users/test",
      platform: "darwin",
    }),
    "/custom/config",
  );
});

test("loads defaults when no config file exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augit-config-test-"));
  const path = join(directory, "config.json");

  assert.deepEqual(await loadConfig({ path }), { ...DEFAULT_CONFIG });
});

test("merges a saved config over the defaults", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augit-config-test-"));
  const path = join(directory, "nested", "config.json");

  await saveConfig({ "auto-stage-all": true }, { path });

  assert.deepEqual(await loadConfig({ path }), {
    AGENT_API_KEY: "",
    AGENT_MODEL: "",
    AGENT_PROVIDER: "auto",
    "auto-stage-all": true,
    "show-scope": true,
    "show-usage-summary": false,
  });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    "auto-stage-all": true,
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("rejects a malformed config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "augit-config-test-"));
  const path = join(directory, "config.json");

  await writeFile(path, "{ not json", "utf8");

  await assert.rejects(loadConfig({ path }), /Failed to parse augit config/);
});

test("config list prints every known key", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand(["list"], io, {
    async load() {
      return {
        AGENT_API_KEY: "sk-secret",
        AGENT_MODEL: "gpt-test",
        AGENT_PROVIDER: "openai",
        "auto-stage-all": true,
        "show-scope": true,
        "show-usage-summary": false,
      };
    },
  });

  assert.equal(status, 0);
  assert.equal(
    state.stdout,
    "AGENT_API_KEY = <redacted>\n" +
      "AGENT_MODEL = gpt-test\n" +
      "AGENT_PROVIDER = openai\n" +
      "auto-stage-all = true\n" +
      "show-scope = true\n" +
      "show-usage-summary = false\n",
  );
});

test("config get prints a single value", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand(["get", "show-usage-summary"], io, {
    async load() {
      return {
        AGENT_API_KEY: "",
        AGENT_MODEL: "",
        AGENT_PROVIDER: "auto",
        "auto-stage-all": false,
        "show-scope": true,
        "show-usage-summary": true,
      };
    },
  });

  assert.equal(status, 0);
  assert.equal(state.stdout, "true\n");
});

test("config set persists a boolean value through the injected save", async () => {
  const { io, state } = fixtureIo();
  const saved = [];

  const status = await runConfigCommand(["set", "auto-stage-all", "true"], io, {
    async load() {
      return { ...DEFAULT_CONFIG };
    },
    async save(config) {
      saved.push(config);
    },
  });

  assert.equal(status, 0);
  assert.equal(state.stdout, "auto-stage-all = true\n");
  assert.deepEqual(saved, [
    {
      AGENT_API_KEY: "",
      AGENT_MODEL: "",
      AGENT_PROVIDER: "auto",
      "auto-stage-all": true,
      "show-scope": true,
      "show-usage-summary": false,
    },
  ]);
});

test("config stores strings and never prints an API key", async () => {
  const { io, state } = fixtureIo();
  const saved = [];

  await runConfigCommand(["set", "AGENT_API_KEY", "sk-secret"], io, {
    async load() {
      return { ...DEFAULT_CONFIG };
    },
    async save(config) {
      saved.push(config);
    },
  });

  assert.equal(saved[0].AGENT_API_KEY, "sk-secret");
  assert.equal(state.stdout, "AGENT_API_KEY = <redacted>\n");
  assert.doesNotMatch(state.stdout, /sk-secret/);
});

test("config stores a trimmed agent model", async () => {
  const { io, state } = fixtureIo();
  let saved;

  await runConfigCommand(["set", "AGENT_MODEL", "  gpt-5.3-codex  "], io, {
    async load() {
      return { ...DEFAULT_CONFIG };
    },
    async save(config) {
      saved = config;
    },
  });

  assert.equal(saved.AGENT_MODEL, "gpt-5.3-codex");
  assert.equal(state.stdout, "AGENT_MODEL = gpt-5.3-codex\n");
});

test("config validates and normalizes the agent provider", async () => {
  const { io, state } = fixtureIo();
  let saved;

  await runConfigCommand(["set", "AGENT_PROVIDER", "CLAUDE"], io, {
    async load() {
      return { ...DEFAULT_CONFIG };
    },
    async save(config) {
      saved = config;
    },
  });

  assert.equal(saved.AGENT_PROVIDER, "claude");
  assert.equal(state.stdout, "AGENT_PROVIDER = claude\n");

  await assert.rejects(
    runConfigCommand(["set", "AGENT_PROVIDER", "ollama"], fixtureIo().io, {
      async load() {
        return { ...DEFAULT_CONFIG };
      },
    }),
    (error) =>
      /Expected one of: auto, openai, codex, claude, deepseek/.test(
        error.message,
      ) && /augit config set AGENT_PROVIDER openai/.test(error.message),
  );
});

test("config hides an API key when reading it", async () => {
  const { io, state } = fixtureIo();

  await runConfigCommand(["get", "AGENT_API_KEY"], io, {
    async load() {
      return { ...DEFAULT_CONFIG, AGENT_API_KEY: "sk-secret" };
    },
  });

  assert.equal(state.stdout, "<redacted>\n");
});

test("environment agent settings override persisted config", () => {
  assert.deepEqual(
    resolveAgentConfig(
      {
        ...DEFAULT_CONFIG,
        AGENT_API_KEY: "saved-key",
        AGENT_MODEL: "saved-model",
        AGENT_PROVIDER: "deepseek",
      },
      {
        env: {
          AGENT_API_KEY: " env-key ",
          AGENT_MODEL: " custom-model ",
          AGENT_PROVIDER: " CLAUDE ",
        },
      },
    ),
    {
      apiKey: "env-key",
      model: "custom-model",
      provider: "claude",
    },
  );
});

test("persisted agent model is used when the environment does not override it", () => {
  assert.deepEqual(
    resolveAgentConfig(
      {
        ...DEFAULT_CONFIG,
        AGENT_API_KEY: "saved-key",
        AGENT_MODEL: "deepseek-chat",
        AGENT_PROVIDER: "deepseek",
      },
      { env: {} },
    ),
    {
      apiKey: "saved-key",
      model: "deepseek-chat",
      provider: "deepseek",
    },
  );
});

test("config rejects an unknown key", async () => {
  await assert.rejects(
    runConfigCommand(["get", "nope"], fixtureIo().io),
    (error) =>
      error instanceof ConfigCommandUsageError &&
      /Unknown config key: nope/.test(error.message),
  );
});

test("config rejects a non-boolean value", async () => {
  await assert.rejects(
    runConfigCommand(["set", "auto-stage-all", "sure"], fixtureIo().io, {
      async load() {
        return { ...DEFAULT_CONFIG };
      },
    }),
    (error) =>
      error instanceof ConfigCommandUsageError &&
      /Expected true or false/.test(error.message),
  );
});

test("config shows every value and update command with no subcommand", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand([], io, {
    async load() {
      return {
        ...DEFAULT_CONFIG,
        AGENT_API_KEY: "sk-secret",
        AGENT_MODEL: "gpt-5-mini",
        AGENT_PROVIDER: "openai",
      };
    },
  });

  assert.equal(status, 0);
  assert.match(state.stdout, /Current configuration:/);
  assert.match(state.stdout, /AGENT_API_KEY = <redacted>/);
  assert.match(state.stdout, /AGENT_MODEL = gpt-5-mini/);
  assert.doesNotMatch(state.stdout, /sk-secret/);

  for (const key of [
    "AGENT_API_KEY",
    "AGENT_MODEL",
    "AGENT_PROVIDER",
    "auto-stage-all",
    "show-scope",
    "show-usage-summary",
  ]) {
    assert.match(state.stdout, new RegExp(`augit config set ${key} `));
  }
});

test("config help describes every key", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand(["--help"], io);

  assert.equal(status, 0);
  assert.match(state.stdout, /AGENT_API_KEY/);
  assert.match(state.stdout, /AGENT_MODEL \(default: <provider default>\)/);
  assert.match(state.stdout, /AGENT_PROVIDER/);
  assert.match(state.stdout, /auto-stage-all/);
  assert.match(state.stdout, /show-scope/);
  assert.match(state.stdout, /show-usage-summary/);
});
