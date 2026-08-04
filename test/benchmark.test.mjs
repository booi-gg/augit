import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreCase, summarizeBenchmark } from "../benchmark/evaluate.mjs";

test("scores expected commit type and semantic keywords", () => {
  const result = scoreCase(
    {
      id: "fixture",
      expectedTypes: ["fix"],
      keywordGroups: [["null", "missing"], ["profile"]],
    },
    {
      subject: "fix(api): handle missing profiles",
      message: "fix(api): handle missing profiles",
    },
  );

  assert.equal(result.typeMatch, true);
  assert.equal(result.keywordHits, 2);
  assert.equal(result.keywordTotal, 2);
});

test("summarizes quality, latency, and memory", () => {
  const summary = summarizeBenchmark(
    [
      {
        id: "one",
        latencyMs: 300,
        typeMatch: true,
        keywordHits: 2,
        keywordTotal: 2,
      },
      {
        id: "two",
        latencyMs: 100,
        typeMatch: false,
        keywordHits: 1,
        keywordTotal: 2,
      },
      {
        id: "three",
        latencyMs: 200,
        typeMatch: true,
        keywordHits: 2,
        keywordTotal: 2,
      },
    ],
    { peakRssBytes: 20 },
  );

  assert.deepEqual(summary, {
    cases: 3,
    validResponses: 3,
    typeAccuracy: 2 / 3,
    keywordAccuracy: 5 / 6,
    coldLatencyMs: 300,
    medianWarmLatencyMs: 150,
    peakRssBytes: 20,
  });
});
