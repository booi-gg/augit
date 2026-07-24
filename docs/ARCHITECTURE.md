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
  buffered output, and stages or commits only after an explicit CLI choice.
- `src/interactive.mjs` owns the terminal-only prompts for an empty index and
  generated-message review. It applies type, scope, and selection colors only
  while writing to a color-capable TTY.
- `src/sanitize.mjs` normalizes control characters, bounds every input class,
  and redacts common credential formats.
- `src/prompt.mjs` serializes evidence as JSON and defines the grammar schema.
- `src/model.mjs` owns the single built-in model, cache paths, atomic locking,
  streaming verification, and cache fingerprints.
- `src/runtime.mjs` lazily loads `node-llama-cpp`, creates a bounded context,
  enforces JSON grammar, and disposes native resources.
- `src/output.mjs` accepts structured or textual adapter results and enforces
  the Conventional Commit contract.
- `src/generate.mjs` orchestrates the pipeline and retries one invalid model
  answer with validation feedback.
- `src/commit.mjs` owns the commit wrapper: option parsing, optional staging,
  review/regeneration, non-interactive confirmation, Git argument passthrough,
  transparent command previews, and runtime reuse/disposal.
- `src/index.mjs` exposes the library surface, routes CLI commands and model
  cache operations, and keeps diagnostics on standard error.

## Trust boundaries

Repository content is untrusted. It may contain secrets, oversized generated
files, control characters, or text attempting to instruct the model. The
sanitizer runs before prompt construction, and the prompt identifies the
serialized repository object as data rather than instructions.

The model output is also untrusted. JSON grammar controls its shape, while the
normalizer independently checks the type, scope, imperative subject, 72
character subject ceiling, body length, and final formatting. The prompt
targets 50-character subjects without truncating exact identifiers. The
normalizer removes boilerplate bodies that only paraphrase the subject and
wraps useful body lines at 72 characters.

## Model lifecycle

Weights are downloaded to a platform cache and verified while streaming.
Concurrent processes coordinate through an atomic directory lock whose mtime
is refreshed during long downloads. Verification metadata records the pinned
digest and a filesystem fingerprint. A fingerprint change forces a complete
rehash before reuse. Cache clearing uses the same lock and removes only the
built-in model and its verification or partial-download sidecars.

The runtime loads the model lazily after staged changes have been found. A
created runtime is disposed by the orchestrator; an injected runtime remains
owned by its caller.
