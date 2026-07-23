# Initial plan

## Goal

Build a fast, local CLI that reads a Git change set and returns one clean
commit message. The model and runtime should remain replaceable.

## Small-model baseline

Begin evaluation with **Qwen2.5-Coder-1.5B-Instruct, GGUF Q4_K_M** through
`node-llama-cpp`.

Why it is the starting point:

- It is code-focused and instruction-tuned.
- The quantized weights are small enough for ordinary developer laptops.
- It should provide better commit-summary quality than sub-billion-parameter
  models while remaining much lighter than 3B+ models.

Do not bundle the weights in the npm tarball. Download them on first use,
verify the artifact, and cache them in the platform cache directory. Users do
not pick a model: the CLI owns one curated built-in choice so the normal
experience is download once and then just run.

Before locking the default, benchmark it against:

- Qwen2.5-Coder-0.5B-Instruct for the smallest/faster option.
- A current 1B–2B general instruction model as a non-code-specialized control.
- A larger 3B code model as the quality ceiling.

## MVP slices

1. Collect staged diff, file status, and a small sample of recent commit style.
2. Redact or truncate unsafe/oversized inputs before inference.
3. Build a compact prompt with a strict output contract.
4. Add a runtime adapter and lazy model download/cache.
5. Validate and normalize the generated subject/body.
6. Expose library and CLI APIs.
7. Benchmark quality, cold start, warm latency, memory, and download size.

## MVP decisions

- Generate from staged changes only.
- Use Conventional Commits by default.
- Offer no model picker or model-selection flag. The implementation can replace
  the built-in model after evaluation without changing the user interface.
- Automatically download the built-in model on first generation. Keep
  `--download-model` only as an optional prefetch for offline preparation.
- Accept the current 1,117,320,768-byte (about 1.12 GB) model download as the
  baseline. Measure peak memory and warm latency before setting final release
  budgets.
- Support CPU inference on macOS, Linux, and Windows. Hardware acceleration is
  optional and must not be required for correct behavior.
- Once cached, run fully offline. Before the first successful download, fail
  with a clear instruction to connect and retry; never leave a partial model
  presented as usable.
