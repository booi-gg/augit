# gitkum

Generate one concise Conventional Commit message from staged changes with a
small local language model.

`gitkum` sends no source code to a hosted inference service. It collects the
staged Git diff, removes common credential patterns, bounds the prompt, runs a
curated GGUF model locally, and lets you commit, generate another message, or
cancel from an interactive review menu.

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
node bin/cli.mjs commit
```

The first generation downloads the built-in model, verifies its SHA-256
digest, and caches it outside the package. The current download is
1,117,320,768 bytes (about 1.12 GB). An ASCII progress bar shows the
transferred bytes and percentage while it downloads.

```text
Downloading model [############------------]  50%  559 MB / 1.12 GB
```

Example interactive output:

```text
Generated commit message:

feat(cli): generate messages from staged changes

❯ Commit
  Generate again
  Cancel
```

Interactive terminals color the Conventional Commit type and scope, highlight
the selected `❯` action, and keep unselected actions subdued. Set `NO_COLOR`
to disable styling. Use the up and down arrow keys (or `j`/`k`) to choose an
action and press Enter. The `y`, `r`, and `c` shortcuts commit, regenerate, and
cancel. Commit writes the staged changes immediately with the complete
generated message. Generate again replaces the proposal, and Cancel leaves the
staged changes untouched.

Subjects use the Conventional Commits structure, target 50 characters, and
have a hard 72-character ceiling so exact names are never truncated. The
subject names the single most important staged change; every other change,
however small, is listed as a "- " line in the body. Body lines are wrapped
at 72 characters. Scopes like `(cli)` are included by default; disable them
with `gitkum config set show-scope false` (see [Configuration](#configuration)).

Running `gitkum` with no arguments (or `-h`/`--help`) only prints usage; it
never reads the working tree or loads the model. Use `gitkum commit` to draft
and review a message.

A small local model can still misinterpret an unusual or very large change, so
review the proposal before selecting Commit.

## CLI

```text
gitkum [options]
gitkum commit [options] [-- GIT_ARGS...]

  commit                Draft, review, and commit staged changes
  config                Get or set persisted configuration
      --clear-model     Delete the downloaded model from the cache
      --download-model  Download and verify the model for offline use
      --model-info      Show information about the built-in model and its cache
  -h, --help            Show help
  -v, --version         Show version
```

There is intentionally no model-selection flag. The product owns one curated
model while the internal runtime adapter and benchmark harness can evaluate
replacements.

### Commit wrapper

`gitkum commit` follows the staged-change workflow from `whatijustdid commit`
while keeping GitKum's local model, secret redaction, bounded prompts, strict
message validation, and regeneration history.

```sh
# Review staged changes, then commit, regenerate, or cancel
gitkum commit

# Stage tracked, modified, deleted, and untracked files first
gitkum commit --all

# Accept the first valid generated message without an interactive prompt
gitkum commit --yes

# Forward flags to git commit after the separator
gitkum commit -- --no-verify
gitkum commit --all --yes -- --signoff
```

The short forms are `-a` and `-y`. The wrapper prints each mutating Git command
before it runs. Arguments before `--` belong to GitKum; arguments after `--`
are passed directly to `git commit`. Non-interactive callers must pass
`--yes`, so a pipeline cannot accidentally wait for a review prompt.

To prepare before going offline:

```sh
node bin/cli.mjs --download-model
```

To see the built-in model identity, parameter count, quantization, token limits,
verification status, cache details, and the CPU/GPU runtime selected on this
machine:

```sh
node bin/cli.mjs --model-info
```

This inspects the cache without downloading the model. It initializes the
native runtime to identify its acceleration backend, but does not load the
model weights.

To reclaim the space used by the downloaded model:

```sh
node bin/cli.mjs --clear-model
```

The next generation downloads and verifies the model again.

Each check is printed as it happens: `Checking staged changes...` followed by
`Found!` or `Not found!`. If nothing is staged, it then checks the working
tree: `Checking for all changes...` followed by `Found!` or `Not found!`. A
clean working tree exits without an action menu. If unstaged or untracked
changes exist, it offers to stage them all or cancel. Pass `--all` to stage
all changes explicitly before generation. In non-interactive use, `gitkum
commit` also requires `--yes`.

After generation in an interactive terminal, the command shows the optional
body and offers Commit, Generate again, and Cancel. Regeneration reuses the
loaded local model and excludes the last three proposals from subsequent
answers. In non-interactive use, `gitkum commit --yes` accepts the first
generated message and creates the commit.

`gitkum` only ever generates from what was staged at the start of the run. If
the working tree still has unstaged or untracked changes after a successful
commit, it prints a reminder to run `gitkum commit` again for those.

## Cache

The verified model is stored at:

- macOS: `~/Library/Caches/gikum/models/`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/gikum/models/`
- Windows: `%LOCALAPPDATA%\gikum\models\`

Set `GIKUM_CACHE_DIR` to override the cache root. Downloads use an atomic,
heartbeat-backed lock, a temporary `.part` file, size verification, and
SHA-256 verification. A cached file is rehashed whenever its filesystem
fingerprint changes.

## Configuration

GitKum persists a small config file that toggles a few optional behaviors.
Each defaults to the behavior described above, so the CLI works as documented
until you opt into a change.

| Key                  | Default | Effect                                                                                           |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `auto-stage-all`     | `false` | When `true`, skip the "Stage all changes and continue" prompt and stage everything automatically |
| `show-scope`         | `true`  | When `false`, generate bare `<type>: <description>` subjects with no `(scope)`                   |
| `show-usage-summary` | `false` | When `true`, print the "Generation usage" (tokens, wall time, CPU, GPU) summary after generating |

Manage these with the `config` command:

```sh
# Show every key and its current value
gitkum config list

# Read a single key
gitkum config get auto-stage-all

# Turn a behavior on or off
gitkum config set auto-stage-all true
gitkum config set show-scope false
gitkum config set show-usage-summary true
```

The config file lives alongside other GitKum state, at:

- macOS: `~/Library/Preferences/gikum/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/gikum/config.json`
- Windows: `%APPDATA%\gikum\config.json`

Set `GIKUM_CONFIG_DIR` to override the config directory. You can also edit
`config.json` directly; unset or unknown keys fall back to their defaults.

## Library

```js
import { generateCommit, generateCommitMessage } from "gikum";

const message = await generateCommitMessage({ cwd: "/path/to/repository" });

const result = await generateCommit({ cwd: "/path/to/repository" });
console.log(result.subject, result.body, result.input, result.usage);
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
- Model output must satisfy the Conventional Commit contract, use an
  imperative subject that targets 50 characters and never exceeds 72, and is
  retried once when invalid.
- Redundant bodies are removed, useful body lines are wrapped at 72
  characters, and the complete body is capped at 400 characters.

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

The built-in baseline is Qwen2.5-Coder-1.5B-Instruct GGUF Q4_K_M: 1,777,088,000
parameters with a 32,768-token model context. GitKum uses a bounded
16,384-token runtime context and generates at most 256 output tokens per
attempt. The model is loaded through `node-llama-cpp`. Weights are pinned to an
immutable upstream revision and are not included in the npm package. See
[third-party notices](THIRD_PARTY_NOTICES.md).
