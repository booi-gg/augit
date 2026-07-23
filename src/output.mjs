const ALLOWED_TYPES = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
]);
const MAX_SUBJECT_LENGTH = 72;
const MAX_BODY_LENGTH = 400;

export class InvalidModelOutputError extends Error {
  constructor(message, options) {
    super(`Invalid generated commit message: ${message}`, options);
    this.name = "InvalidModelOutputError";
    this.code = "INVALID_MODEL_OUTPUT";
  }
}

export function normalizeCommitMessage(value, { requiredType } = {}) {
  const output = parseOutput(value);

  if (typeof output.subject !== "string") {
    throw new InvalidModelOutputError("subject must be a string.");
  }

  if (output.body !== undefined && typeof output.body !== "string") {
    throw new InvalidModelOutputError("body must be a string.");
  }

  const subject = normalizeSubject(output.subject, { requiredType });
  let body = normalizeBody(output.body || "");

  if (body.toLocaleLowerCase() === subject.toLocaleLowerCase()) {
    body = "";
  }

  return {
    subject,
    body,
    message: body ? `${subject}\n\n${body}` : subject,
  };
}

function parseOutput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    throw new InvalidModelOutputError(
      "runtime returned neither an object nor text.",
    );
  }

  const text = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(text);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Alternate runtime adapters may return an already formatted message.
  }

  const [subject = "", ...bodyLines] = text.replace(/\r\n?/g, "\n").split("\n");

  return {
    subject,
    body: bodyLines.join("\n").trim(),
  };
}

function normalizeSubject(value, { requiredType } = {}) {
  if (/[\r\n]/.test(value)) {
    throw new InvalidModelOutputError("subject must be one line.");
  }

  const compact = cleanControls(value)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "");
  const match =
    /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/i.exec(
      compact,
    );

  if (!match) {
    throw new InvalidModelOutputError("subject is not a Conventional Commit.");
  }

  const generatedType = match.groups.type.toLocaleLowerCase();

  if (!ALLOWED_TYPES.has(generatedType)) {
    throw new InvalidModelOutputError(
      `unsupported Conventional Commit type "${generatedType}".`,
    );
  }

  if (requiredType && !ALLOWED_TYPES.has(requiredType)) {
    throw new TypeError(`Unsupported required commit type: ${requiredType}`);
  }

  const type = requiredType || generatedType;
  let scope = "";

  if (match.groups.scope) {
    scope = match.groups.scope.trim().toLocaleLowerCase().replace(/\s+/g, "-");
    const pathParts = scope.split("/");

    scope = pathParts.at(-1);
    scope = scope.replace(
      /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|mdx?|rst|adoc|ya?ml|json)$/,
      "",
    );

    if (!/^[a-z0-9._/-]+$/.test(scope)) {
      throw new InvalidModelOutputError(
        "scope contains unsupported characters.",
      );
    }

    if (scope === type) {
      scope = "";
    }
  }

  const description = match.groups.description.trim().replace(/\.+$/, "");

  if (!description) {
    throw new InvalidModelOutputError("subject description is empty.");
  }

  if (
    type === "test" &&
    /^(?:add|create|write) (?:a )?tests?\b/i.test(description)
  ) {
    throw new InvalidModelOutputError(
      'replace "add test for ..." with "test: cover <behavior>".',
    );
  }

  if (
    /^(?:change|improve|modify|update) (?:code|files?|project|stuff|things?)$/i.test(
      description,
    )
  ) {
    throw new InvalidModelOutputError(
      "subject description is too vague to identify the staged change.",
    );
  }

  const normalized =
    type +
    (scope ? `(${scope})` : "") +
    (match.groups.breaking || "") +
    `: ${description}`;

  if (normalized.length > MAX_SUBJECT_LENGTH) {
    throw new InvalidModelOutputError(
      `subject exceeds ${MAX_SUBJECT_LENGTH} characters.`,
    );
  }

  return normalized;
}

function normalizeBody(value) {
  const normalized = cleanControls(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");

  if (normalized.length > MAX_BODY_LENGTH) {
    throw new InvalidModelOutputError(
      `body exceeds ${MAX_BODY_LENGTH} characters.`,
    );
  }

  return normalized;
}

function cleanControls(value) {
  return String(value).replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
}
