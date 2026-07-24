import assert from "node:assert/strict";
import { test } from "node:test";

import { generateCommit, generateCommitMessage } from "../src/generate.mjs";

function fixtureContext() {
  return {
    repository: "fixture",
    files: [{ status: "M", path: "src/index.js" }],
    recentSubjects: ["feat: initialize project"],
    diff: "+export const ready = true;\n",
    diffTruncated: false,
  };
}

test("runs collection, model preparation, inference, and normalization", async () => {
  const calls = [];
  const runtime = {
    async generate({ modelPath, prompt }) {
      calls.push(["runtime", modelPath, prompt]);
      return {
        subject: "feat(core): generate local commit messages",
        body: "",
      };
    },
    getUsage() {
      return {
        generations: 1,
        tokens: {
          input: 900,
          output: 20,
          total: 920,
        },
      };
    },
  };

  const result = await generateCommit({
    cwd: "/repo",
    collector: async ({ cwd }) => {
      calls.push(["collector", cwd]);
      return fixtureContext();
    },
    ensureModel: async () => {
      calls.push(["model"]);
      return { path: "/cache/model.gguf", downloaded: false };
    },
    runtime,
  });

  assert.equal(result.message, "feat(core): generate local commit messages");
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["collector", "model", "runtime"],
  );
  assert.equal(calls[0][1], "/repo");
  assert.match(calls[2][2], /stagedFiles/);
  assert.deepEqual(result.usage, {
    generations: 1,
    tokens: {
      input: 900,
      output: 20,
      total: 920,
    },
  });
});

test("retries one invalid model response with validation feedback", async () => {
  const prompts = [];
  const runtime = {
    async generate({ prompt }) {
      prompts.push(prompt);

      if (prompts.length === 1) {
        return { subject: "changed things", body: "" };
      }

      return { subject: "fix: describe the staged change", body: "" };
    },
  };

  const result = await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime,
  });

  assert.equal(result.message, "fix: describe the staged change");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous answer was invalid/i);
});

test("regeneration rejects and repairs a repeated proposal", async () => {
  const previousMessage = "feat(cli): review generated commits";
  const prompts = [];
  const runtime = {
    async generate({ prompt }) {
      prompts.push(prompt);

      if (prompts.length === 1) {
        return { subject: previousMessage, body: "" };
      }

      return {
        subject: "feat(cli): confirm generated commits",
        body: "",
      };
    },
  };

  const result = await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    previousMessages: [previousMessage],
    runtime,
  });

  assert.equal(result.message, "feat(cli): confirm generated commits");
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /previousProposals/);
  assert.match(prompts[0], /review generated commits/);
  assert.match(prompts[1], /repeats a previous proposal/i);
});

test("uses deterministic sampling for a fresh generation", async () => {
  const calls = [];
  const runtime = {
    async generate(options) {
      calls.push(options);
      return { subject: "feat: run locally", body: "" };
    },
  };

  await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].seed, undefined);
});

test("diversifies sampling when regenerating or repairing", async () => {
  const previousMessage = "feat(cli): review generated commits";
  const calls = [];
  const runtime = {
    async generate(options) {
      calls.push(options);

      if (calls.length === 1) {
        return { subject: previousMessage, body: "" };
      }

      return { subject: "feat(cli): confirm generated commits", body: "" };
    },
  };

  await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    previousMessages: [previousMessage],
    runtime,
  });

  assert.equal(calls.length, 2);

  for (const call of calls) {
    assert.equal(call.temperature, 0.8);
    assert.equal(typeof call.seed, "number");
  }

  assert.notEqual(calls[0].seed, calls[1].seed);
});

test("disposes a runtime that it creates", async () => {
  let disposed = 0;
  const message = await generateCommitMessage({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    createRuntime: () => ({
      async generate() {
        return { subject: "feat: add runtime lifecycle", body: "" };
      },
      async dispose() {
        disposed += 1;
      },
    }),
  });

  assert.equal(message, "feat: add runtime lifecycle");
  assert.equal(disposed, 1);
});
