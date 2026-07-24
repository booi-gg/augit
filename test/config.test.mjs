import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ConfigCommandUsageError,
  DEFAULT_CONFIG,
  getConfigDirectory,
  loadConfig,
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
    "/Users/test/Library/Preferences/gikum",
  );
  assert.equal(
    getConfigDirectory({
      env: { XDG_CONFIG_HOME: "/etc/xdg/test" },
      home: "/home/test",
      platform: "linux",
    }),
    "/etc/xdg/test/gikum",
  );
  assert.equal(
    getConfigDirectory({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      home: "C:\\Users\\test",
      platform: "win32",
    }),
    join("C:\\Users\\test\\AppData\\Roaming", "gikum"),
  );
  assert.equal(
    getConfigDirectory({
      env: { GIKUM_CONFIG_DIR: "/custom/config" },
      home: "/Users/test",
      platform: "darwin",
    }),
    "/custom/config",
  );
});

test("loads defaults when no config file exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gikum-config-test-"));
  const path = join(directory, "config.json");

  assert.deepEqual(await loadConfig({ path }), { ...DEFAULT_CONFIG });
});

test("merges a saved config over the defaults", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gikum-config-test-"));
  const path = join(directory, "nested", "config.json");

  await saveConfig({ "auto-stage-all": true }, { path });

  assert.deepEqual(await loadConfig({ path }), {
    "auto-stage-all": true,
    "show-scope": true,
    "show-usage-summary": false,
  });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    "auto-stage-all": true,
  });
});

test("rejects a malformed config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gikum-config-test-"));
  const path = join(directory, "config.json");

  await writeFile(path, "{ not json", "utf8");

  await assert.rejects(loadConfig({ path }), /Failed to parse gitkum config/);
});

test("config list prints every known key", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand(["list"], io, {
    async load() {
      return {
        "auto-stage-all": true,
        "show-scope": true,
        "show-usage-summary": false,
      };
    },
  });

  assert.equal(status, 0);
  assert.equal(
    state.stdout,
    "auto-stage-all = true\nshow-scope = true\nshow-usage-summary = false\n",
  );
});

test("config get prints a single value", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand(["get", "show-usage-summary"], io, {
    async load() {
      return {
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
    { "auto-stage-all": true, "show-scope": true, "show-usage-summary": false },
  ]);
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

test("config prints help with no subcommand", async () => {
  const { io, state } = fixtureIo();

  const status = await runConfigCommand([], io);

  assert.equal(status, 0);
  assert.match(state.stdout, /gitkum config/);
  assert.match(state.stdout, /auto-stage-all/);
  assert.match(state.stdout, /show-scope/);
  assert.match(state.stdout, /show-usage-summary/);
});
