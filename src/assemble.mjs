/**
 * Building a commit message from validated per-file summaries, without asking a
 * model to rank anything.
 *
 * Ranking is the one part of this job a 1.5B model fails at consistently: given
 * a list sorted biggest-first with the line counts attached, it still headlines a
 * two-line spinner tweak. It is also the one part that needs no language ability
 * at all - the churn counts are already measured, so the order is arithmetic.
 * What the model is good at, describing one small diff, has already happened by
 * the time this runs.
 */

import {
  MAX_BODY_LENGTH,
  MAX_BODY_LINE_LENGTH,
  MAX_SUBJECT_LENGTH,
} from "./output.mjs";
import { namesOnlyTheFile } from "./summarize.mjs";

const TEST_PATH =
  /(^|\/)(?:tests?|__tests__|spec)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const DOCS_PATH = /\.(?:mdx?|rst|adoc|txt)$/i;
const CI_PATH = /(^|\/)\.(?:github|circleci|gitlab-ci)/i;
const BUILD_PATH =
  /(^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Dockerfile|Makefile)$/i;
// Past tense to imperative. A summary reports what a diff did; a subject tells
// the reader what applying it does.
const IMPERATIVE = new Map([
  ["added", "add"],
  ["adds", "add"],
  ["changed", "change"],
  ["created", "create"],
  ["extracted", "extract"],
  ["fixed", "fix"],
  ["introduced", "introduce"],
  ["moved", "move"],
  ["removed", "remove"],
  ["renamed", "rename"],
  ["replaced", "replace"],
  ["restructured", "restructure"],
  ["split", "split"],
  ["updated", "update"],
]);
const FEAT_VERBS = /^(?:add|create|introduce|support)\b/i;
const FIX_VERBS = /^(?:fix|guard|prevent|correct|handle|stop)\b/i;
const REFACTOR_VERBS = /^(?:move|extract|rename|replace|restructure|split)\b/i;
// Trailing words that leave a trimmed line hanging mid-thought. Shortening at a
// word boundary is not enough on its own: "add a feature to the file, which now"
// is inside the limit and still stops mid-clause.
const DANGLING =
  /\b(?:a|an|and|are|as|at|by|for|from|in|into|is|it|its|now|of|on|or|per|that|the|their|then|these|this|to|was|were|which|while|who|whose|with)$/i;

/**
 * A commit message assembled from the summaries, or null when none survived
 * validation and there is therefore nothing honest to say.
 */
export function assembleCommitFromSummaries(
  summaries = [],
  { allowScope = true, requiredType, validate = () => true } = {},
) {
  const usable = summaries.filter((entry) => entry?.summary);

  if (usable.length === 0) {
    return null;
  }

  // Already churn-ordered by the summary pass; sorting again keeps this function
  // correct on its own terms rather than relying on the caller.
  const ranked = [...usable].sort(
    (left, right) => (right.changedLines || 0) - (left.changedLines || 0),
  );
  const type = requiredType || inferType(ranked);

  // Biggest change first, then the next, until one produces a subject the
  // validator accepts. Shortening the headline can leave it saying nothing, and
  // a smaller change described concretely beats the largest described vacuously.
  for (const [index, headline] of ranked.entries()) {
    const scope = allowScope ? scopeFor(headline.path) : "";
    const prefix = `${type}${scope ? `(${scope})` : ""}: `;
    const description = fitLine(
      toImperative(headline.summary),
      MAX_SUBJECT_LENGTH - prefix.length,
    );

    // A summary earns its place by being concrete, and shortening can take that
    // away: "add a feature to assemble.mjs, which ranks tasks by churn" becomes
    // "add a feature to assemble.mjs". Re-checking after the cut, not before, is
    // what stops a vacuous subject reaching the user.
    if (!description || namesOnlyTheFile(description, headline.path)) {
      continue;
    }

    const subject = `${prefix}${description}`;
    const rest = ranked.filter((_, other) => other !== index);
    const body = buildBody(rest, description);
    const candidate = {
      subject,
      body,
      message: body ? `${subject}\n\n${body}` : subject,
    };

    if (validate(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * One "- " line per remaining task, most important first, stopping at the body
 * limit.
 *
 * A line whose wording repeats the subject is left out rather than padded, and
 * lines are added whole: a half-sentence about a file says less than the file's
 * absence does.
 */
function buildBody(rest, description) {
  const seen = new Set([normalizeForCompare(description)]);
  const lines = [];
  let length = 0;

  for (const entry of rest) {
    const text = fitLine(toImperative(entry.summary), MAX_BODY_LINE_LENGTH - 2);
    const key = normalizeForCompare(text);

    if (!text || seen.has(key) || namesOnlyTheFile(text, entry.path)) {
      continue;
    }

    const line = `- ${text}`;
    const cost = length === 0 ? line.length : line.length + 1;

    if (length + cost > MAX_BODY_LENGTH) {
      break;
    }

    seen.add(key);
    lines.push(line);
    length += cost;
  }

  return lines.join("\n");
}

/**
 * A Conventional Commit type read from what the files are and what the headline
 * says it did.
 *
 * Deliberately conservative: it prefers the type that a reader could verify from
 * the file list, and only reads the verb when the paths say nothing.
 */
function inferType(ranked) {
  const paths = ranked.map((entry) => entry.path || "");

  if (paths.every((path) => TEST_PATH.test(path))) {
    return "test";
  }

  if (paths.every((path) => DOCS_PATH.test(path))) {
    return "docs";
  }

  if (paths.every((path) => CI_PATH.test(path))) {
    return "ci";
  }

  if (paths.every((path) => BUILD_PATH.test(path))) {
    return "build";
  }

  const summary = ranked[0].summary;

  if (FIX_VERBS.test(summary)) {
    return "fix";
  }

  if (FEAT_VERBS.test(summary)) {
    return "feat";
  }

  if (REFACTOR_VERBS.test(summary)) {
    return "refactor";
  }

  return "chore";
}

function scopeFor(path) {
  if (!path) {
    return "";
  }

  const base = (path.split(/[\\/]/).at(-1) || "").toLocaleLowerCase();
  const scope = base.replace(
    /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|mdx?|rst|adoc|ya?ml|json|lock)$/,
    "",
  );

  return /^[a-z0-9._-]+$/.test(scope) ? scope : "";
}

function toImperative(summary) {
  const text = String(summary).trim().replace(/\.+$/, "");
  const [first, ...others] = text.split(" ");
  const imperative = IMPERATIVE.get(first.toLocaleLowerCase());
  const head = imperative || first.toLocaleLowerCase();

  return [head, ...others]
    .join(" ")
    .replace(/^(\w+) a new /i, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `text` shortened to `limit` characters, cut at the last clause boundary if
 * there is one and at a word boundary otherwise, or "" when nothing usable fits.
 *
 * Preferring a clause boundary is what keeps a shortened line readable: cutting
 * "add a summary pass, which reads each file whole" at the comma states a whole
 * fact, where cutting it at the limit states half of one.
 */
function fitLine(text, limit) {
  if (limit <= 0) {
    return "";
  }

  if (text.length <= limit) {
    return stripDangling(text);
  }

  const window = text.slice(0, limit + 1);
  const clause = window.search(/[,;:]\s(?!$)/);
  const boundary =
    clause > Math.floor(limit / 3) ? clause : window.lastIndexOf(" ");

  return stripDangling(boundary === -1 ? "" : window.slice(0, boundary));
}

function stripDangling(value) {
  let trimmed = value.replace(/[\s,;:(]+$/, "");

  while (trimmed && DANGLING.test(trimmed)) {
    const previous = trimmed.lastIndexOf(" ");

    trimmed = previous === -1 ? "" : trimmed.slice(0, previous);
  }

  return trimmed.replace(/[\s,;:(]+$/, "");
}

function normalizeForCompare(value) {
  return String(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
