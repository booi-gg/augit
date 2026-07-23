import { DEFAULT_MAX_DIFF_BYTES } from "./git.mjs";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_HISTORY = 8;
const DEFAULT_MAX_PATH_LENGTH = 240;
const DEFAULT_MAX_REPOSITORY_LENGTH = 100;
const DEFAULT_MAX_SUBJECT_LENGTH = 160;
const REDACTED = "[REDACTED]";

export function sanitizeGitContext(
  context,
  {
    maxDiffBytes = DEFAULT_MAX_DIFF_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    maxHistory = DEFAULT_MAX_HISTORY,
    maxPathLength = DEFAULT_MAX_PATH_LENGTH,
    maxRepositoryLength = DEFAULT_MAX_REPOSITORY_LENGTH,
    maxSubjectLength = DEFAULT_MAX_SUBJECT_LENGTH,
  } = {},
) {
  let redactionCount = 0;
  const redact = (value) => {
    const result = redactSecrets(cleanText(value));

    redactionCount += result.count;
    return result.value;
  };
  const sourceFiles = Array.isArray(context.files) ? context.files : [];
  const files = sourceFiles.slice(0, maxFiles).map((file) => {
    const sanitized = {
      status: truncateCharacters(cleanText(file.status), 12),
      path: truncateCharacters(redact(file.path), maxPathLength),
    };

    if (file.previousPath) {
      sanitized.previousPath = truncateCharacters(
        redact(file.previousPath),
        maxPathLength,
      );
    }

    return sanitized;
  });
  const recentSubjects = (context.recentSubjects || [])
    .slice(0, maxHistory)
    .map((subject) => truncateCharacters(redact(subject), maxSubjectLength));
  const redactedDiff = redact(context.diff || "");
  const diff = truncateUtf8(redactedDiff, maxDiffBytes);

  return {
    repository: truncateCharacters(
      redact(context.repository || "repository"),
      maxRepositoryLength,
    ),
    files,
    filesTruncated:
      Boolean(context.filesTruncated) || sourceFiles.length > files.length,
    recentSubjects,
    diff,
    diffTruncated:
      Boolean(context.diffTruncated) ||
      Buffer.byteLength(redactedDiff) > Buffer.byteLength(diff),
    redactionCount,
  };
}

export function redactSecrets(value) {
  let count = 0;
  let result = value;
  const replace = (pattern, replacement) => {
    result = result.replace(pattern, (...args) => {
      count += 1;
      return typeof replacement === "function"
        ? replacement(...args)
        : replacement;
    });
  };

  replace(
    /(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|token|client[_-]?secret)\b\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;#]+)/gi,
    (_match, prefix) => `${prefix}${REDACTED}`,
  );
  replace(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    REDACTED,
  );
  replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*$/g, REDACTED);
  replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED);
  replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED);
  replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED);
  replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED);
  replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, REDACTED);
  replace(
    /(\bAuthorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
    (_match, prefix) => `${prefix}${REDACTED}`,
  );
  replace(
    /(https?:\/\/)[^/\s:@]+:[^@/\s]+@/gi,
    (_match, prefix) => `${prefix}${REDACTED}@`,
  );

  return { value: result, count };
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function truncateCharacters(value, maximum) {
  return Array.from(value).slice(0, maximum).join("");
}

function truncateUtf8(value, maximum) {
  const buffer = Buffer.from(value);

  if (buffer.length <= maximum) {
    return value;
  }

  let end = maximum;

  while (end > 0) {
    const truncated = buffer.subarray(0, end).toString("utf8");

    if (!truncated.endsWith("\uFFFD")) {
      return truncated;
    }

    end -= 1;
  }

  return "";
}
