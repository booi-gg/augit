# augit

Generate a Conventional Commit message from staged changes using an agent API.

Augit reads only the Git index, redacts common credentials, bounds the prompt,
asks the configured provider for structured JSON, validates the result, and
lets you commit, generate another message, or cancel.

Supported providers:

- OpenAI
- Codex models through the OpenAI API
- Claude through the Anthropic API
- DeepSeek

## Requirements

- Node.js 22.13 or newer
- Git
- An API key with access to the selected provider

## Install

```sh
npm install --global @booi-dev/augit
```

Or run the repository checkout directly:

```sh
pnpm install
node bin/cli.mjs --help
```

## Configure an agent

Set the provider explicitly, then save the key. Referencing an existing shell
variable keeps the secret itself out of the command saved in shell history.

```sh
# OpenAI
augit config set AGENT_PROVIDER openai
augit config set AGENT_API_KEY "$OPENAI_API_KEY"

# Codex (uses an OpenAI API key)
augit config set AGENT_PROVIDER codex
augit config set AGENT_API_KEY "$OPENAI_API_KEY"

# Claude
augit config set AGENT_PROVIDER claude
augit config set AGENT_API_KEY "$ANTHROPIC_API_KEY"

# DeepSeek
augit config set AGENT_PROVIDER deepseek
augit config set AGENT_API_KEY "$DEEPSEEK_API_KEY"
```

`AGENT_PROVIDER=auto` detects `sk-ant-...` Claude keys and modern OpenAI
project/service keys. A plain `sk-...` key can belong to either OpenAI or
DeepSeek, so Augit refuses to guess and asks for an explicit provider. This
prevents sending a credential to the wrong company.

Environment variables override the saved config, which is useful in CI:

```sh
AGENT_PROVIDER=deepseek AGENT_API_KEY="$DEEPSEEK_API_KEY" augit commit --yes
```

Augit currently selects these cost-conscious defaults:

| Provider   | Default model       |
| ---------- | ------------------- |
| `openai`   | `gpt-5-mini`        |
| `codex`    | `gpt-5.3-codex`     |
| `claude`   | `claude-haiku-4-5`  |
| `deepseek` | `deepseek-v4-flash` |

Persist a different model for the selected provider with:

```sh
augit config set AGENT_MODEL gpt-5.3-codex
```

Set `AGENT_MODEL` to an empty string to return to the provider default. The
`AGENT_MODEL` environment variable overrides saved config for one-off runs and
CI. Provider model access and API charges still apply.

Large multi-file changes can use several API requests: Augit may summarize
individual files before asking for the final commit message, and invalid or
truncated responses are retried.

## Usage

Stage the intended change, then ask Augit to draft and review the commit:

```sh
git add src/index.js test/index.test.js
augit commit
```

Useful forms:

```sh
# Stage all changes first
augit commit --all

# Accept the first generated message (for scripts and CI)
augit commit --yes

# Pass options through to git commit
augit commit -- --no-verify
augit commit --all --yes -- --signoff
```

The interactive review offers **Commit**, **Generate again**, and **Cancel**.
Regeneration reuses the same API runtime and asks for a proposal different from
the last three results.

## Configuration

| Key                  | Default     | Effect                                                                             |
| -------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `AGENT_API_KEY`      | `<not set>` | Provider credential. CLI output always shows `<redacted>` once configured          |
| `AGENT_MODEL`        | empty       | Model ID; an empty value selects the provider's default                            |
| `AGENT_PROVIDER`     | `auto`      | `auto`, `openai`, `codex`, `claude`, or `deepseek`                                 |
| `auto-stage-all`     | `false`     | Skip the staging prompt and stage all changes automatically                        |
| `show-scope`         | `true`      | Include a scope such as `fix(cli): ...`; set `false` for a bare `fix: ...` subject |
| `show-usage-summary` | `false`     | Print provider, model, token counts, and wall time after generation                |

Manage the file with:

```sh
# Show all current values plus an update command for each setting
augit config

# Compact values-only output or one specific value
augit config list
augit config get AGENT_PROVIDER

# Update each available setting
augit config set AGENT_API_KEY "$OPENAI_API_KEY"
augit config set AGENT_PROVIDER openai
augit config set AGENT_MODEL gpt-5.3-codex
augit config set auto-stage-all true
augit config set show-scope false
augit config set show-usage-summary true
```

Bare `augit config` shows all current settings and the update examples above.
The API key remains redacted in this view. `config list`, `config get
AGENT_API_KEY`, and `config set AGENT_API_KEY ...` also never print the
credential. The config file is written with owner-only (`0600`) permissions on
Unix-like systems and lives at:

- macOS: `~/Library/Preferences/augit/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/augit/config.json`
- Windows: `%APPDATA%\augit\config.json`

Set `AUGIT_CONFIG_DIR` to override the directory.

### Setup errors

Augit prints provider errors to stderr with the provider name, HTTP status when
available, and a **How to fix** section. The suggested action depends on the
failure:

- missing or rejected key: confirm the provider and save a fresh provider key;
- ambiguous or unsupported provider: set `AGENT_PROVIDER` explicitly;
- missing, unavailable, or unauthorized model: set an available model or reset
  `AGENT_MODEL` to the provider default;
- quota or rate limit: check provider billing and limits before retrying; and
- network or provider server failure: check connectivity/status and retry.

Provider error text is sanitized before printing, and the configured API key is
never included. Remember that `AGENT_API_KEY`, `AGENT_PROVIDER`, and
`AGENT_MODEL` environment variables override the values shown by `augit config`.

## What leaves the machine

Moving to an API means the sanitized prompt is sent to the selected provider.
It can contain repository name, staged paths, recent commit style, and bounded
staged diff text. Augit applies the controls below before making the request:

- Only staged changes are read.
- Git runs without a shell or external diff driver.
- Binary payloads are excluded.
- Diffs are capped at 24 KiB by default.
- Complete prompts are capped at 20 KiB.
- Common keys, tokens, passwords, private keys, and credential URLs are
  redacted.
- Repository content is marked as untrusted prompt data.
- Responses must satisfy the Conventional Commit contract and are retried when
  invalid or truncated.

These controls reduce accidental exposure; they are not a general-purpose
secret scanner. Review your provider's data policy before sending sensitive
source code.

## Library

The default runtime reads `AGENT_API_KEY`, `AGENT_PROVIDER`, and `AGENT_MODEL`
from saved config, with environment variables taking precedence:

```js
import { generateCommit, generateCommitMessage } from "@booi-dev/augit";

const message = await generateCommitMessage({ cwd: "/path/to/repository" });
const result = await generateCommit({ cwd: "/path/to/repository" });

console.log(message, result.subject, result.body, result.input, result.usage);
```

An integration can create and reuse a configured runtime:

```js
import { createAgentRuntime, generateCommit } from "@booi-dev/augit";

const runtime = createAgentRuntime({
  apiKey: process.env.MY_AGENT_KEY,
  provider: "claude",
});

try {
  const result = await generateCommit({ runtime });
  console.log(result.message);
} finally {
  await runtime.dispose();
}
```

Callers may also inject a runtime implementing:

```js
{
  async generate({ prompt, schema, signal }) {
    return { subject: "feat: example", body: "" };
  }
}
```

## Development

```sh
pnpm install
pnpm check
pnpm test:coverage
npm pack --dry-run
```

The unit suite mocks every provider and never makes a paid API request.

The benchmark uses the configured provider and therefore makes billable API
calls:

```sh
pnpm benchmark
pnpm benchmark -- --provider claude --model claude-haiku-4-5 --json
```

See [the architecture](docs/ARCHITECTURE.md) and
[benchmark methodology](docs/BENCHMARKS.md).
