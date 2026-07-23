# chill-commit

A standalone Node package for generating concise Git commit messages from
staged changes with a small local language model.

The repository is currently an implementation scaffold. It includes a working
CLI shell, a verified model downloader, tests, pnpm metadata, and Conductor
workspace setup.

## Development

Requirements:

- Node.js 22.13 or newer
- pnpm 10

```sh
pnpm install
pnpm check
node bin/cli.mjs --help
```

The CLI owns its model choice. There is no model picker or model-selection
flag. On the first commit-generation run, it will download the built-in model,
verify its SHA-256 digest, and cache it outside the npm package. To prepare
before going offline:

```sh
node bin/cli.mjs --download-model
```

The current built-in model is Qwen2.5-Coder-1.5B-Instruct GGUF Q4_K_M. Its
download is 1,117,320,768 bytes (about 1.12 GB). Cached runs do not need a
network connection. If the first download is attempted offline, the CLI
explains that a connection is needed and leaves no partial model behind.

## Direction

- Local-first: source diffs should stay on the developer's machine.
- CLI-first with a reusable library core.
- Pick one built-in model, download it on first use, and cache it outside the
  npm package.
- Start evaluation with Qwen2.5-Coder-1.5B-Instruct in GGUF Q4_K_M form.
- Keep the model runtime behind an adapter so benchmarks can replace the
  built-in model without exposing model selection to users or changing Git
  collection and output validation.

See [docs/PLAN.md](docs/PLAN.md) for the proposed MVP.
