# MVP plan

## Goal

Build a fast, local CLI that reads staged Git changes and returns one clean
Conventional Commit message. Keep model selection and inference behind
replaceable internal adapters.

## Status

| Slice                                         | Status            | Implementation                          |
| --------------------------------------------- | ----------------- | --------------------------------------- |
| Collect staged diff, status, and recent style | Complete          | `src/git.mjs`                           |
| Redact and bound model input                  | Complete          | `src/sanitize.mjs`                      |
| Build a strict prompt and response contract   | Complete          | `src/prompt.mjs`                        |
| Download, verify, cache, and load the model   | Complete          | `src/model.mjs`, `src/runtime.mjs`      |
| Validate and normalize generated output       | Complete          | `src/output.mjs`                        |
| Expose CLI and library APIs                   | Complete          | `src/index.mjs`, `src/generate.mjs`     |
| Review, regenerate, and commit messages       | Complete          | `src/commit.mjs`, `src/interactive.mjs` |
| Measure quality, latency, memory, and size    | Baseline complete | `benchmark/`, `docs/BENCHMARKS.md`      |

The benchmark harness is intentionally separate from the product CLI. It can
load alternate GGUF files without exposing a user-facing model picker.

## Decisions

- Generate from staged changes only.
- Use Conventional Commits.
- Offer no product model picker.
- Download the curated model on first generation.
- Keep `--download-model` as optional offline preparation.
- Keep model weights out of the npm tarball.
- Pin the model URL, size, and SHA-256 digest.
- Support CPU inference on macOS, Linux, and Windows; use acceleration when
  `node-llama-cpp` safely detects it. A native source build may be required
  where no matching prebuilt runtime exists.
- Fail clearly before first offline use and never present a partial download
  as usable.
- Review generated messages in an arrow-key menu before committing.
- Offer commit, regenerate, and cancel actions in interactive terminals.
- Match the `whatijustdid commit` wrapper with `--all`, `--yes`, and
  post-`--` Git argument passthrough while preserving a non-committing bare
  command for pipelines.
- Color generated subjects and the selected menu action only on supported
  terminals.
- Target 50-character subjects, enforce a 72-character ceiling, and omit bodies
  unless they add concrete release-note-worthy context.
- Print only the generated message when standard output is redirected.

## Release gates

- The complete test and package checks pass on Node.js 22.13 and the current
  Node.js release across macOS, Linux, and Windows.
- Benchmark responses are valid for every fixture.
- Type accuracy is at least 80%.
- Semantic keyword accuracy is at least 70%.
- Peak memory and warm latency are recorded for each supported platform before
  declaring a final performance budget.
- Package metadata, license, third-party notices, and model attribution ship in
  the npm tarball.
