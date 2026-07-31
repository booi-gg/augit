import assert from "node:assert/strict";
import { test } from "node:test";

import { generateCommit, generateCommitMessage } from "../src/generate.mjs";

// A real change, so the copy check has something to compare subjects against.
function fixtureContext() {
  return {
    repository: "fixture",
    files: [{ status: "M", path: "src/index.js" }],
    recentSubjects: ["feat: initialize project"],
    diff:
      "diff --git a/src/index.js b/src/index.js\n" +
      "--- a/src/index.js\n" +
      "+++ b/src/index.js\n" +
      "@@ -1,1 +1,4 @@\n" +
      "-export const displayName = (user) => user.profile.name;\n" +
      "+export function displayName(user) {\n" +
      '+  if (!user.profile) return "anonymous";\n' +
      "+  return user.profile.name;\n" +
      "+}\n",
    diffTruncated: false,
  };
}

test("runs collection, model preparation, inference, and normalization", async () => {
  const calls = [];
  const runtime = {
    async generate({ modelPath, prompt }) {
      calls.push(["runtime", modelPath, prompt]);
      return {
        subject: "feat(core): return a default display name",
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

  assert.equal(result.message, "feat(core): return a default display name");
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

      return { subject: "fix: guard a missing profile", body: "" };
    },
  };

  const result = await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime,
  });

  assert.equal(result.message, "fix: guard a missing profile");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous answer invalid/i);
});

test("keeps a body that the staged diff supports", async () => {
  const result = await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime: {
      async generate() {
        return {
          subject: "fix: guard a missing profile",
          body: '- return "anonymous" instead of reading name off undefined',
        };
      },
    },
  });

  assert.match(result.body, /anonymous/);
});

test("drops a hollow body rather than retrying for a new one", async () => {
  const prompts = [];
  const result = await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime: {
      async generate({ prompt }) {
        prompts.push(prompt);
        return {
          subject: "fix: guard a missing profile",
          body: "Improve the profile card so it is easier to read.",
        };
      },
    },
  });

  assert.equal(prompts.length, 1);
  assert.equal(result.body, "");
  assert.equal(result.message, "fix: guard a missing profile");
});
test("retries a subject copied verbatim out of the diff", async () => {
  const prompts = [];
  const result = await generateCommit({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime: {
      async generate({ prompt }) {
        prompts.push(prompt);

        if (prompts.length === 1) {
          return { subject: "fix: return user.profile.name", body: "" };
        }

        return { subject: "fix: guard a missing profile", body: "" };
      },
    },
  });

  assert.equal(result.message, "fix: guard a missing profile");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /copied out of the diff/);
});
test("regeneration rejects and repairs a repeated proposal", async () => {
  const previousMessage = "fix(cli): guard a missing profile";
  const prompts = [];
  const runtime = {
    async generate({ prompt }) {
      prompts.push(prompt);

      if (prompts.length === 1) {
        return { subject: previousMessage, body: "" };
      }

      return {
        subject: "fix(cli): return a default display name",
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

  assert.equal(result.message, "fix(cli): return a default display name");
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /previousProposals/);
  assert.match(prompts[0], /guard a missing profile/);
  assert.match(prompts[1], /repeats a previous proposal/i);
});

test("uses deterministic sampling for a fresh generation", async () => {
  const calls = [];
  const runtime = {
    async generate(options) {
      calls.push(options);
      return { subject: "fix: return a default display name", body: "" };
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
  const previousMessage = "fix(cli): guard a missing profile";
  const calls = [];
  const runtime = {
    async generate(options) {
      calls.push(options);

      if (calls.length === 1) {
        return { subject: previousMessage, body: "" };
      }

      return { subject: "fix(cli): return a default display name", body: "" };
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

test("strips the scope from the result when scopes are disabled", async () => {
  const runtime = {
    async generate() {
      return { subject: "fix(cli): handle a missing profile", body: "" };
    },
  };

  const result = await generateCommit({
    allowScope: false,
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    runtime,
  });

  assert.equal(result.subject, "fix: handle a missing profile");
});

test("disposes a runtime that it creates", async () => {
  let disposed = 0;
  const message = await generateCommitMessage({
    collector: async () => fixtureContext(),
    ensureModel: async () => ({ path: "/cache/model.gguf" }),
    createRuntime: () => ({
      async generate() {
        return { subject: "fix: guard a missing profile", body: "" };
      },
      async dispose() {
        disposed += 1;
      },
    }),
  });

  assert.equal(message, "fix: guard a missing profile");
  assert.equal(disposed, 1);
});
