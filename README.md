# chill-commit

A standalone Node package for generating concise Git commit messages from
staged changes with a small local language model.

The repository is currently an implementation scaffold. It includes a working
CLI shell, tests, pnpm metadata, and Conductor workspace setup.

## Development

Requirements:

- Node.js 22.13 or newer
- pnpm 10

```sh
pnpm install
pnpm check
pnpm exec chill-commit --help
```

## Direction

- Local-first: source diffs should stay on the developer's machine.
- CLI-first with a reusable library core.
- Download model weights on first use and cache them outside the npm package.
- Start evaluation with Qwen2.5-Coder-1.5B-Instruct in GGUF Q4_K_M form.
- Keep the model runtime behind an adapter so benchmarks can replace the
  initial model without changing Git collection or output validation.

See [docs/PLAN.md](docs/PLAN.md) for the proposed MVP.
