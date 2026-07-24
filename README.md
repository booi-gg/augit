# gitkum

Generate one concise Conventional Commit message from staged changes with a
small local language model.

`gitkum` sends no source code to a hosted inference service. It collects the
staged Git diff, removes common credential patterns, bounds the prompt, runs a
curated GGUF model locally, and prints the validated message to standard
output.

## Requirements

- Node.js 22.13 or newer
- pnpm 10 for development
- Git
- macOS, Linux, or Windows

`node-llama-cpp` uses a prebuilt native runtime when one is available. A C/C++
toolchain and CMake may be required for a platform or CPU-only configuration
without a matching prebuilt binary.

## Use from this checkout

```sh
pnpm install
git add path/to/changed-files
node bin/cli.mjs
```

The first generation downloads the built-in model, verifies its SHA-256
digest, and caches it outside the package. The current download is
1,117,320,768 bytes (about 1.12 GB). An ASCII progress bar shows the
transferred bytes and percentage while it downloads.

```text
Downloading model [############------------]  50%  559 MB / 1.12 GB
```

Example output:

```text
feat(cli): generate commit messages from staged changes
```

Progress and diagnostics go to standard error, so standard output can be used
directly:

```sh
git commit -m "$(node bin/cli.mjs)"
```

Review generated messages before committing. A small local model can still
misinterpret an unusual or very large change.

## CLI

```text
gitkum [options]

      --clear-model     Delete the downloaded model from the cache
      --download-model  Download and verify the model for offline use
  -h, --help            Show help
  -v, --version         Show version
```

There is intentionally no model-selection flag. The product owns one curated
model while the internal runtime adapter and benchmark harness can evaluate
replacements.

To prepare before going offline:

```sh
node bin/cli.mjs --download-model
```

To reclaim the space used by the downloaded model:

```sh
node bin/cli.mjs --clear-model
```

The next generation downloads and verifies the model again.

If no changes are staged in an interactive terminal, the command offers to
stage all tracked and untracked changes and continue, or to cancel. Selecting
cancel leaves the index untouched. In non-interactive use, the command exits
without downloading or loading the model.

## Cache

The verified model is stored at:

- macOS: `~/Library/Caches/gikum/models/`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/gikum/models/`
- Windows: `%LOCALAPPDATA%\gikum\models\`

Set `GIKUM_CACHE_DIR` to override the cache root. Downloads use an atomic,
heartbeat-backed lock, a temporary `.part` file, size verification, and
SHA-256 verification. A cached file is rehashed whenever its filesystem
fingerprint changes.

## Library

```js
import { generateCommit, generateCommitMessage } from "gikum";

const message = await generateCommitMessage({ cwd: "/path/to/repository" });

const result = await generateCommit({ cwd: "/path/to/repository" });
console.log(result.subject, result.body, result.input);
```

The lower-level Git collector, sanitizer, output normalizer, model cache, and
runtime factory are also exported for testing or integration. Callers may
inject a runtime implementing:

```js
{
  async generate({ modelPath, prompt, signal }) {
    return { subject: "feat: example", body: "" };
  }
}
```

## Safety and limits

- Only staged changes are read.
- Git is executed without a shell or external diff driver.
- Binary payloads are not added to the prompt.
- Diffs are capped at 24 KiB by default.
- The complete serialized prompt is capped at 14 KiB to fit the bounded model
  context without shifting away instructions.
- File lists, paths, and recent subjects are bounded.
- Common keys, tokens, passwords, private keys, and credential URLs are
  redacted.
- Repository content is explicitly marked as untrusted prompt data.
- Model output must satisfy the Conventional Commit contract and is retried
  once when invalid.

These controls reduce accidental exposure and prompt injection; they are not a
general-purpose secret scanner.

## Development

```sh
pnpm install
pnpm check
pnpm test:coverage
pnpm smoke:runtime
npm pack --dry-run
```

The test suite uses small fixtures and never downloads model weights.

Run the real quality and performance benchmark after prefetching the model:

```sh
pnpm benchmark -- --download
```

For internal comparisons with another compatible GGUF model:

```sh
pnpm benchmark -- --model-path /absolute/path/model.gguf --json
```

See [the architecture](docs/ARCHITECTURE.md),
[benchmark methodology](docs/BENCHMARKS.md), and
[MVP plan](docs/PLAN.md).

## Model

The built-in baseline is
Qwen2.5-Coder-1.5B-Instruct GGUF Q4_K_M, loaded through `node-llama-cpp`.
Weights are pinned to an immutable upstream revision and are not included in
the npm package. See [third-party notices](THIRD_PARTY_NOTICES.md).
