# Architecture

The generation path has explicit boundaries so Git handling, model choice, and
output rules can evolve independently.

```text
staged Git data
      |
      v
collector -> sanitizer -> prompt builder -> runtime adapter -> validator
      |                                                    |
      +---------------- result metadata <------------------+
```

## Components

- `src/git.mjs` runs Git directly with `spawn`, collects only the index, caps
  buffered output, and stages or commits only after an explicit CLI option or
  review choice.
- `src/interactive.mjs` owns terminal status styling, the unstaged-change
  choice, and generated-message review. It applies status, type, scope, and
  selection colors only while writing to a color-capable TTY.
- `src/sanitize.mjs` normalizes control characters, bounds every input class,
  and redacts common credential formats.
- `src/prompt.mjs` serializes evidence as JSON and defines the output schema.
- `src/config.mjs` owns typed persisted settings, secret-safe display, config
  file permissions, and environment overrides.
- `src/runtime.mjs` resolves the provider without sending a key speculatively,
  translates the common runtime contract to OpenAI Responses, Claude Messages,
  or DeepSeek Chat Completions, and records provider token usage.
- `src/output.mjs` accepts structured or textual adapter results and enforces
  the Conventional Commit contract.
- `src/generate.mjs` orchestrates the pipeline and retries one invalid model
  answer with validation feedback.
- `src/commit.mjs` owns the commit wrapper: option parsing, optional staging,
  review/regeneration, non-interactive confirmation, Git argument passthrough,
  transparent command previews, and runtime reuse/disposal.
- `src/index.mjs` exposes the library surface, routes CLI commands, and keeps
  diagnostics on standard error.

## Trust boundaries

Repository content is untrusted. It may contain secrets, oversized generated
files, control characters, or text attempting to instruct the model. The
sanitizer runs before prompt construction, and the prompt identifies the
serialized repository object as data rather than instructions.

The sanitized prompt crosses a network trust boundary and is sent only to the
explicitly configured provider. Automatic provider detection recognizes only
unambiguous key formats; it never probes several vendors with the same secret.
Provider errors and config output do not echo the API key.

The model output is also untrusted. Provider structured-output controls shape
where available, while the normalizer independently checks the type, scope,
imperative subject, 72-character subject ceiling, body length, and final
formatting. The prompt targets 50-character subjects without truncating exact
identifiers. The normalizer removes boilerplate bodies that only paraphrase the
subject and wraps useful body lines at 72 characters.

## Runtime lifecycle

The commit workflow creates one API runtime and reuses it across validation
retries and regenerated proposals. A runtime created inside `generateCommit`
is disposed there; an injected runtime remains owned by its caller. The usage
meter accumulates provider-reported input/output tokens and wall time. The CLI
writes the optional diagnostic summary to standard error so standard output
remains suitable for command substitution.
