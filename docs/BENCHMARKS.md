# Benchmarks

The benchmark suite compares supported API providers and models against the
same fixed Augit prompts and validators.

## Dataset

`benchmark/cases.json` contains focused staged-diff fixtures for bug fixes, new
CLI behavior, documentation, tests, refactoring, and CI configuration. Each
fixture defines acceptable Conventional Commit types and semantic keyword
groups.

This is a smoke-quality gate, not a substitute for human evaluation. Add
anonymized real-world diffs before making a final provider or model decision.

## Run

The benchmark uses `AGENT_API_KEY`, `AGENT_PROVIDER`, and `AGENT_MODEL` from
saved config, with environment variables and benchmark flags taking precedence.
It makes real, potentially billable API requests.

```sh
pnpm benchmark
pnpm benchmark -- --json
pnpm benchmark -- --provider claude --model claude-haiku-4-5 --json
```

The report includes:

- provider and model;
- valid response count;
- Conventional Commit type accuracy;
- semantic keyword accuracy;
- first-case cold latency;
- median subsequent latency; and
- sampled peak resident memory.

## Quality targets

| Metric                    |       Target |
| ------------------------- | -----------: |
| Valid responses           |         100% |
| Type accuracy             | at least 80% |
| Semantic keyword accuracy | at least 70% |

Record the provider, exact model, fixture revision, prompt revision, date, and
API settings with every baseline. Do not compare runs that changed fixtures or
prompts without identifying that change.
