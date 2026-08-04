import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { loadConfig, resolveAgentConfig } from "../src/config.mjs";
import { generateCommit } from "../src/generate.mjs";
import { createAgentRuntime } from "../src/runtime.mjs";
import { scoreCase, summarizeBenchmark } from "./evaluate.mjs";

const options = parseArguments(process.argv.slice(2));
const cases = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);
const configured = resolveAgentConfig(await loadConfig());
const runtime = createAgentRuntime({
  ...configured,
  ...(options.model ? { model: options.model } : {}),
  ...(options.provider ? { provider: options.provider } : {}),
});
const rows = [];
let peakRssBytes = process.memoryUsage().rss;
const memorySampler = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
}, 100);

try {
  for (const definition of cases) {
    const startedAt = performance.now();

    try {
      const result = await generateCommit({
        collector: async () => definition.context,
        runtime,
      });
      const row = {
        ...scoreCase(definition, result),
        latencyMs: Math.round(performance.now() - startedAt),
      };

      rows.push(row);
      process.stderr.write(`Evaluated ${definition.id}: ${row.message}\n`);
    } catch (error) {
      rows.push({
        id: definition.id,
        error: error.message,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      process.stderr.write(`Failed ${definition.id}: ${error.message}\n`);
    }
  }
} finally {
  clearInterval(memorySampler);
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  await runtime.dispose();
}

const summary = summarizeBenchmark(rows, {
  peakRssBytes,
});
const report = {
  model: `${runtime.provider}/${runtime.model}`,
  generatedAt: new Date().toISOString(),
  platform: {
    arch: process.arch,
    node: process.version,
    os: process.platform,
  },
  summary,
  cases: rows,
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      `Model: ${report.model}`,
      `Valid responses: ${summary.validResponses}/${summary.cases}`,
      `Type accuracy: ${formatPercent(summary.typeAccuracy)}`,
      `Keyword accuracy: ${formatPercent(summary.keywordAccuracy)}`,
      `Cold latency: ${formatMilliseconds(summary.coldLatencyMs)}`,
      `Median warm latency: ${formatMilliseconds(summary.medianWarmLatencyMs)}`,
      `Peak RSS: ${formatBytes(summary.peakRssBytes)}`,
      "",
    ].join("\n"),
  );
}

function parseArguments(args) {
  const parsed = {
    json: false,
    model: undefined,
    provider: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--") {
      continue;
    } else if (argument === "--json") {
      parsed.json = true;
    } else if (argument === "--model" && args[index + 1]) {
      parsed.model = args[++index];
    } else if (argument === "--provider" && args[index + 1]) {
      parsed.provider = args[++index];
    } else {
      throw new Error(`Unknown benchmark option: ${argument}`);
    }
  }

  return parsed;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatMilliseconds(value) {
  return value === null ? "n/a" : `${value} ms`;
}

function formatBytes(value) {
  if (value === null) {
    return "n/a";
  }

  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;

  while (amount >= 1_000 && unit < units.length - 1) {
    amount /= 1_000;
    unit += 1;
  }

  return `${amount.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}
