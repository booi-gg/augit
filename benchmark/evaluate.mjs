export function scoreCase(definition, result) {
  const message = result.message || "";
  const subject = result.subject || message.split("\n", 1)[0] || "";
  const type = /^([a-z]+)(?:\([^)]+\))?!?: /.exec(subject)?.[1];
  const searchable = message.toLocaleLowerCase();
  const keywordGroups = definition.keywordGroups || [];
  const keywordHits = keywordGroups.filter((group) =>
    group.some((keyword) => searchable.includes(keyword.toLocaleLowerCase())),
  ).length;

  return {
    id: definition.id,
    message,
    valid: Boolean(subject),
    type,
    typeMatch: (definition.expectedTypes || []).includes(type),
    keywordHits,
    keywordTotal: keywordGroups.length,
  };
}

export function summarizeBenchmark(rows, { modelBytes, peakRssBytes } = {}) {
  const successful = rows.filter((row) => !row.error);
  const latencies = successful.map((row) => row.latencyMs);
  const warmLatencies = latencies.slice(1);
  const keywordHits = successful.reduce(
    (total, row) => total + row.keywordHits,
    0,
  );
  const keywordTotal = successful.reduce(
    (total, row) => total + row.keywordTotal,
    0,
  );

  return {
    cases: rows.length,
    validResponses: successful.length,
    typeAccuracy:
      rows.length === 0
        ? 0
        : successful.filter((row) => row.typeMatch).length / rows.length,
    keywordAccuracy: keywordTotal === 0 ? 0 : keywordHits / keywordTotal,
    coldLatencyMs: latencies[0] ?? null,
    medianWarmLatencyMs:
      warmLatencies.length === 0 ? null : median(warmLatencies),
    modelBytes: modelBytes ?? null,
    peakRssBytes: peakRssBytes ?? null,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}
