# Benchmarks

The benchmark suite measures whether a candidate local model is suitable for
the fixed product interface. It does not expose model selection in `gikum`.

## Dataset

`benchmark/cases.json` contains focused staged-diff fixtures for:

- bug fixes;
- new CLI behavior;
- documentation;
- tests;
- refactoring; and
- CI configuration.

Each fixture defines acceptable Conventional Commit types and semantic keyword
groups. This is a smoke-quality gate, not a substitute for human evaluation.
Add anonymized real-world diffs before making a final model decision.

## Run

Use the built-in model, downloading it if needed:

```sh
pnpm benchmark -- --download
```

Use an already cached built-in model:

```sh
pnpm benchmark
```

Compare another compatible GGUF file without changing the product CLI:

```sh
pnpm benchmark -- --model-path /absolute/path/model.gguf --json
```

The report includes:

- valid response count;
- Conventional Commit type accuracy;
- semantic keyword accuracy;
- first-case cold latency;
- median subsequent latency;
- sampled peak resident memory; and
- model file size.

## Initial release targets

| Metric                    |       Target |
| ------------------------- | -----------: |
| Valid responses           |         100% |
| Type accuracy             | at least 80% |
| Semantic keyword accuracy | at least 70% |

Latency and memory budgets remain platform-specific until baseline results are
recorded on macOS, Linux, and Windows.

## Baseline

Built-in model baseline recorded on 2026-07-23:

| Environment | Value                                           |
| ----------- | ----------------------------------------------- |
| Machine     | MacBook Pro, Apple M4 Pro (12 cores), 24 GB RAM |
| OS          | macOS 26.5.2 arm64                              |
| Node.js     | 24.14.1                                         |
| Runtime     | node-llama-cpp 3.19.1 with Metal                |
| Model       | Qwen2.5-Coder-1.5B-Instruct Q4_K_M              |

| Metric                    |                        Result |
| ------------------------- | ----------------------------: |
| Valid responses           |                    6/6 (100%) |
| Type accuracy             |                          100% |
| Semantic keyword accuracy |                         91.7% |
| Cold latency              |                      1,560 ms |
| Median warm latency       |                        840 ms |
| Sampled peak RSS          | 2,075,410,432 bytes (2.08 GB) |
| Model size                | 1,117,320,768 bytes (1.12 GB) |

The exact case outputs are stored in
[`benchmark/results/2026-07-23-m4-pro.json`](../benchmark/results/2026-07-23-m4-pro.json).
This six-case synthetic smoke suite clears the initial release gates but is not
a cross-platform or statistically robust quality claim.

Do not compare models using different fixtures or prompt revisions without
identifying the change.
