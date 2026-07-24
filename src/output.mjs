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
export const TARGET_SUBJECT_LENGTH = 50;
export const MAX_SUBJECT_LENGTH = 72;
export const MAX_BODY_LENGTH = 400;
export const MAX_BODY_LINE_LENGTH = 72;
const GENERIC_BODY_WORDS = new Set([
  "align",
  "aligned",
  "alignment",
  "appropriate",
  "better",
  "change",
  "changed",
  "changes",
  "clear",
  "clearly",
  "code",
  "coded",
  "correctly",
  "enhance",
  "enhanced",
  "ensure",
  "ensures",
  "ensuring",
  "help",
  "helps",
  "improve",
  "improved",
  "improves",
  "maintainability",
  "new",
  "now",
  "overall",
  "organization",
  "project",
  "properly",
  "provide",
  "provides",
  "purpose",
  "reflect",
  "reflects",
  "rename",
  "renamed",
  "scope",
  "support",
  "supports",
  "update",
  "updated",
]);
const TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "s",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

export class InvalidModelOutputError extends Error {
  constructor(message, options) {
    super(`Invalid generated commit message: ${message}`, options);
    this.name = "InvalidModelOutputError";
    this.code = "INVALID_MODEL_OUTPUT";
  }
}

export function normalizeCommitMessage(
  value,
  { allowScope = true, requiredType } = {},
) {
  const output = parseOutput(value);

  if (typeof output.subject !== "string") {
    throw new InvalidModelOutputError("subject must be a string.");
  }

  if (output.body !== undefined && typeof output.body !== "string") {
    throw new InvalidModelOutputError("body must be a string.");
  }

  const subject = normalizeSubject(output.subject, { allowScope, requiredType });
  let body = normalizeBody(output.body || "");

  if (isRedundantBody(subject, body)) {
    body = "";
  } else {
    body = wrapBody(body);
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

function normalizeSubject(value, { allowScope = true, requiredType } = {}) {
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

  if (!allowScope) {
    scope = "";
  }

  const description = match.groups.description.trim().replace(/\.+$/, "");

  if (!description) {
    throw new InvalidModelOutputError("subject description is empty.");
  }

  if (
    /^(?:added|adds|adding|changed|changes|changing|created|creates|creating|fixed|fixes|fixing|removed|removes|removing|renamed|renames|renaming|updated|updates|updating)\b/i.test(
      description,
    )
  ) {
    throw new InvalidModelOutputError(
      "subject description must start with an imperative verb.",
    );
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

function isRedundantBody(subject, body) {
  if (!body) {
    return false;
  }

  if (/^BREAKING[ -]CHANGE:/im.test(body)) {
    return false;
  }

  if (body.toLocaleLowerCase() === subject.toLocaleLowerCase()) {
    return true;
  }

  const subjectMatch =
    /^(?:[a-z]+)(?:\((?<scope>[^)]+)\))?!?: (?<description>.+)$/i.exec(subject);

  if (!subjectMatch) {
    return false;
  }

  const subjectTokens = tokenize(
    `${subjectMatch.groups.scope || ""} ${subjectMatch.groups.description}`,
  );
  const bodyTokens = tokenize(body);

  if (subjectTokens.length === 0 || bodyTokens.length === 0) {
    return false;
  }

  const matchedSubjectTokens = subjectTokens.filter((subjectToken) =>
    bodyTokens.some((bodyToken) => tokensMatch(subjectToken, bodyToken)),
  );
  const novelBodyTokens = bodyTokens.filter(
    (bodyToken) =>
      !subjectTokens.some((subjectToken) =>
        tokensMatch(subjectToken, bodyToken),
      ) && !GENERIC_BODY_WORDS.has(bodyToken),
  );
  const subjectCoverage = matchedSubjectTokens.length / subjectTokens.length;
  const startsWithBoilerplate =
    /^(?:this (?:commit|change|update)\b|the .{0,80}\b(?:has|have|is|are|was|were)(?: been)?\b)/i.test(
      body,
    );

  return (
    subjectCoverage >= 0.75 &&
    (startsWithBoilerplate || novelBodyTokens.length <= 1)
  );
}

function tokenize(value) {
  return (
    value.toLocaleLowerCase().match(/[\p{L}\p{N}@][\p{L}\p{N}@._/-]*/gu) || []
  )
    .map((token) => token.replace(/^[._/-]+|[._/-]+$/g, ""))
    .filter((token) => token && !TOKEN_STOP_WORDS.has(token));
}

function tokensMatch(left, right) {
  if (left === right) {
    return true;
  }

  return tokenForms(left).has(right) || tokenForms(right).has(left);
}

function tokenForms(token) {
  const forms = new Set([token]);

  if (token.length > 4 && token.endsWith("ies")) {
    forms.add(`${token.slice(0, -3)}y`);
  }

  if (token.length > 4 && token.endsWith("ied")) {
    forms.add(`${token.slice(0, -3)}y`);
  }

  if (token.length > 4 && token.endsWith("ing")) {
    forms.add(token.slice(0, -3));
    forms.add(`${token.slice(0, -3)}e`);
  }

  if (token.length > 3 && token.endsWith("ed")) {
    forms.add(token.slice(0, -2));
    forms.add(token.slice(0, -1));
  }

  if (token.length > 3 && token.endsWith("s")) {
    forms.add(token.slice(0, -1));
  }

  return forms;
}

function wrapBody(value) {
  if (!value) {
    return "";
  }

  const wrapped = value
    .split("\n")
    .flatMap((line) => wrapBodyLine(line))
    .join("\n");

  if (wrapped.length > MAX_BODY_LENGTH) {
    throw new InvalidModelOutputError(
      `body exceeds ${MAX_BODY_LENGTH} characters after wrapping.`,
    );
  }

  return wrapped;
}

function wrapBodyLine(line) {
  if (line.length <= MAX_BODY_LINE_LENGTH || line.length === 0) {
    return [line];
  }

  const bullet = /^(?<prefix>[-*] )(?<content>.*)$/.exec(line);
  const firstPrefix = bullet?.groups.prefix || "";
  const continuationPrefix = bullet ? "  " : "";
  const words = (bullet?.groups.content || line).split(/\s+/);
  const lines = [];
  let current = firstPrefix;

  for (const word of words) {
    const prefix = lines.length === 0 ? firstPrefix : continuationPrefix;

    if (word.length + prefix.length > MAX_BODY_LINE_LENGTH) {
      throw new InvalidModelOutputError(
        `body contains a word longer than ${MAX_BODY_LINE_LENGTH} characters.`,
      );
    }

    if (
      current.length > prefix.length &&
      current.length + 1 + word.length > MAX_BODY_LINE_LENGTH
    ) {
      lines.push(current);
      current = `${continuationPrefix}${word}`;
    } else {
      current += current.length > prefix.length ? ` ${word}` : word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function cleanControls(value) {
  return String(value).replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
}
