import { spawn } from "node:child_process";
import { basename } from "node:path";

export const DEFAULT_MAX_DIFF_BYTES = 24 * 1024;
const DEFAULT_MAX_STATUS_BYTES = 512 * 1024;
const DEFAULT_RECENT_COMMIT_LIMIT = 8;

export class GitContextError extends Error {
  constructor(message, { code = "GIT_CONTEXT_FAILED", cause } = {}) {
    super(message, { cause });
    this.name = "GitContextError";
    this.code = code;
  }
}

export class NotGitRepositoryError extends GitContextError {
  constructor(cwd) {
    super(`Not a Git repository: ${cwd}`, { code: "NOT_GIT_REPOSITORY" });
    this.name = "NotGitRepositoryError";
  }
}

export class NoStagedChangesError extends GitContextError {
  constructor() {
    super("No staged changes found.", {
      code: "NO_STAGED_CHANGES",
    });
    this.name = "NoStagedChangesError";
  }
}

export async function collectStagedChanges({
  cwd = process.cwd(),
  maxDiffBytes = DEFAULT_MAX_DIFF_BYTES,
  recentCommitLimit = DEFAULT_RECENT_COMMIT_LIMIT,
} = {}) {
  const probe = await runGit(["rev-parse", "--is-inside-work-tree"], {
    allowFailure: true,
    cwd,
  });

  if (probe.code !== 0 || probe.stdout.trim() !== "true") {
    throw new NotGitRepositoryError(cwd);
  }

  const rootResult = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  const statusResult = await runGit(
    ["diff", "--cached", "--name-status", "--find-renames", "-z", "--"],
    {
      cwd,
      maxStdoutBytes: DEFAULT_MAX_STATUS_BYTES,
    },
  );
  const files = parseNameStatus(statusResult.stdout, {
    truncated: statusResult.stdoutTruncated,
  });

  if (files.length === 0) {
    throw new NoStagedChangesError();
  }

  const [diffResult, logResult] = await Promise.all([
    runGit(
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--unified=3",
        "--",
      ],
      { cwd, maxStdoutBytes: maxDiffBytes },
    ),
    runGit(["log", "-z", `-n${recentCommitLimit}`, "--format=%s"], {
      allowFailure: true,
      cwd,
      maxStdoutBytes: 16 * 1024,
    }),
  ]);

  return {
    repository: basename(rootResult.stdout.trim()),
    root: rootResult.stdout.trim(),
    files,
    filesTruncated: statusResult.stdoutTruncated,
    recentSubjects:
      logResult.code === 0 ? parseNullSeparated(logResult.stdout) : [],
    diff: diffResult.stdout,
    diffTruncated: diffResult.stdoutTruncated,
  };
}

export async function stageAllChanges({ cwd = process.cwd() } = {}) {
  await runGit(["add", "--all", "--"], { cwd });
}

export async function hasWorkingTreeChanges({ cwd = process.cwd() } = {}) {
  const result = await runGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--"],
    {
      cwd,
      maxStdoutBytes: 1,
    },
  );

  return result.stdout.length > 0;
}

export async function commitStagedChanges({
  args = [],
  cwd = process.cwd(),
  message,
} = {}) {
  if (typeof message !== "string" || !message.trim()) {
    throw new TypeError("A non-empty commit message is required.");
  }

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("Git commit arguments must be an array of strings.");
  }

  return runGit(["commit", "--message", message, ...args, "--"], { cwd });
}

export function parseNameStatus(value, { truncated = false } = {}) {
  const tokens = value.split("\0");

  if (tokens.at(-1) === "") {
    tokens.pop();
  } else if (truncated) {
    tokens.pop();
  }

  const files = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];

    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = tokens[index++];
      const path = tokens[index++];

      if (previousPath !== undefined && path !== undefined) {
        files.push({ status, path, previousPath });
      }
    } else {
      const path = tokens[index++];

      if (path !== undefined) {
        files.push({ status, path });
      }
    }
  }

  return files;
}

async function runGit(args, options) {
  try {
    return await runProcess("git", args, options);
  } catch (cause) {
    if (cause instanceof GitContextError) {
      throw cause;
    }

    throw new GitContextError("Could not run Git.", { cause });
  }
}

function runProcess(
  command,
  args,
  {
    allowFailure = false,
    cwd,
    maxStdoutBytes = 64 * 1024,
    maxStderrBytes = 64 * 1024,
  },
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PAGER: "cat",
        LC_ALL: "C",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = createCapture(maxStdoutBytes);
    const stderr = createCapture(maxStderrBytes);
    let settled = false;

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (cause) => {
      if (!settled) {
        settled = true;
        reject(cause);
      }
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      const result = {
        code: code ?? 1,
        signal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      };

      if (result.code !== 0 && !allowFailure) {
        reject(
          new GitContextError(
            result.stderr.trim() || `Git exited with status ${result.code}.`,
            { code: "GIT_COMMAND_FAILED" },
          ),
        );
        return;
      }

      resolve(result);
    });
  });
}

function createCapture(limit) {
  const chunks = [];
  let bytes = 0;

  return {
    truncated: false,
    push(chunk) {
      if (bytes >= limit) {
        this.truncated = true;
        return;
      }

      const remaining = limit - bytes;
      const kept = chunk.subarray(0, remaining);

      chunks.push(kept);
      bytes += kept.length;

      if (kept.length < chunk.length) {
        this.truncated = true;
      }
    },
    text() {
      return decodeUtf8Prefix(Buffer.concat(chunks));
    },
  };
}

function decodeUtf8Prefix(buffer) {
  let end = buffer.length;

  while (end > 0) {
    const value = buffer.subarray(0, end).toString("utf8");

    if (!value.endsWith("\uFFFD")) {
      return value;
    }

    end -= 1;
  }

  return "";
}

function parseNullSeparated(value) {
  return value
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean);
}
