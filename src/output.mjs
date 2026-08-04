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
// Vacuous verbs. Every one has a concrete alternative that names the actual
// change, and the prompt already asks for that alternative. Matched anywhere,
// not just at the start: "update dependencies to improve performance" is the
// same empty claim as "improve performance". The trailing guard keeps package
// names such as better-sqlite3 and refine-cli out of it.
export const WEAK_VERB =
  /\b(?:better|enhances?|improves?|optimi[sz]es?|polish(?:es)?|refines?|tweaks?)(?![-\w])/i;
// Verbs that report a file was touched without saying what the touch did. Every
// inflection is spelled out because a body line or a file summary arrives in
// past tense where a subject may not. Verbs that really do act on the file -
// add, remove, rename, move, split - are deliberately absent: for those the file
// is the change.
const CONTAINER_VERB =
  /^(?:adjust|adjusts|adjusted|adjusting|amend|amends|amended|amending|change|changes|changed|changing|edit|edits|edited|editing|modify|modifies|modified|modifying|revise|revises|revised|revising|tweak|tweaks|tweaked|tweaking|update|updates|updated|updating)\s+(?:the\s+)?(?<target>[^\s,;:]+)/i;
// Sentences that sell the change instead of stating it. A model reaches
// for these when it has nothing concrete left to say.
export const BENEFIT_CLAIM =
  /\b(?:user experience|easier to (?:\w+)|more (?:readable|maintainable|robust|intuitive|user-friendly)|better (?:reflects?|user|readability|experience)|improves? the\b|makes? (?:it|the \w+) (?:easier|better|clearer|simpler))/i;
// Five words is longer than any phrase a real description shares with a rule
// line by accident, and short enough to catch an example handed back as the
// answer: "run lint and test before push" is exactly five once filler is
// dropped.
const INSTRUCTION_RUN_WORDS = 5;
let cachedInstructionRuns = { runs: null, source: null };
// A word counts as a path only when it is written as one. Without the suffix
// list "config" and "1.5" become files the change never touched.
const FILE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|mdx?|rst|adoc|ya?ml|json|toml|lock|sh|bash|zsh|css|scss|less|html|txt|xml|ini|cfg|conf|sql|gradle|properties)$/i;
// Technologies whose names end in a file suffix. "bump node.js to 22" names a
// runtime, not a file, and nothing in the repository will ever match it.
const LIBRARY_NAMES = new Set([
  "d3.js",
  "express.js",
  "next.js",
  "node.js",
  "nuxt.js",
  "react.js",
  "three.js",
  "vue.js",
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
  { allowScope = true, evidence, requiredType } = {},
) {
  const output = parseOutput(value);

  if (typeof output.subject !== "string") {
    throw new InvalidModelOutputError("subject must be a string.");
  }

  if (output.body !== undefined && typeof output.body !== "string") {
    throw new InvalidModelOutputError("body must be a string.");
  }

  const searchableDiff = evidence ? flattenDiffForSearch(evidence.diff) : "";
  const instructions = evidence?.instructions || "";
  // A truncated list cannot say a file was not staged, only that it is not in
  // the part that survived, so the unstaged-path check stands down rather than
  // rejecting a message that names a real file.
  const knownFiles = evidence?.filesTruncated ? [] : evidence?.files || [];
  const subject = normalizeSubject(output.subject, {
    allowScope,
    instructions,
    knownFiles,
    requiredType,
    searchableDiff,
    stagedFiles: evidence?.files || [],
  });
  let body = normalizeBody(output.body || "");

  // A body is optional, so a bad one is dropped rather than retried. Losing real
  // context costs less than committing a hollow claim, and the subject already
  // carries the change.
  if (
    isRedundantBody(subject, body) ||
    BENEFIT_CLAIM.test(body) ||
    body
      .split("\n")
      .some(
        (line) =>
          isCopiedFromDiff(line, searchableDiff) ||
          isCopiedFromInstructions(line, instructions) ||
          hasUnfilledSlot(line) ||
          namesUnstagedFile(line, knownFiles),
      )
  ) {
    body = "";
  } else {
    // Dropped bodies above were padding, so losing them loses nothing. A line
    // built on a filename is the opposite: it carries a task the subject had no
    // room for, described as a file touch. Dropping it would drop the task, so
    // the message is rejected instead and the reason goes back to the model,
    // which keeps the task and names the edit.
    const containerLine = body
      .split("\n")
      .find((line) => namesFileAsObject(line, evidence?.files || []));

    if (containerLine) {
      throw new InvalidModelOutputError(
        `body line "${containerLine.replace(/^\s*[-*]\s*/, "")}" names the ` +
          "file that was touched, not the change; say what is different " +
          "inside it, and name both sides of anything that was replaced.",
      );
    }

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

/**
 * True when `text` is not a description of the change but a run of characters
 * lifted straight out of it.
 *
 * A staged diff often carries prose that looks like an answer: a commit message
 * in a test fixture, a heading in a README, a docstring. A model can
 * return that prose verbatim, and every word of it is "grounded" because it
 * really is in the diff, so grounding alone cannot see the problem. Describing
 * a change and quoting it are different acts.
 */
export function isCopiedFromDiff(text, searchableDiff) {
  if (!searchableDiff) {
    return false;
  }

  const needle = flattenForSearch(text.replace(/^[-*]\s*/, ""));

  // Short phrases collide with ordinary code by chance; a long one does not.
  return needle.length >= 16 && searchableDiff.includes(needle);
}

/**
 * True when `text` still carries a slot from an example instead of the fact
 * that belongs in it: "rename to <new-name>".
 *
 * Writing the examples with placeholders keeps the model from copying a
 * plausible sentence out of them, but it does not stop it copying the
 * placeholder, and that answer is worse than the one it replaced: "<new-name>"
 * cannot be mistaken for a description of anything, yet it passes every check
 * that asks whether the wording is grounded, because there is no wording in it.
 * The word-run check cannot see it either - the copied fragment is two words.
 */
export function hasUnfilledSlot(text) {
  return /<[^<>]{1,40}>/.test(String(text || ""));
}

/**
 * True when `text` reuses a run of words from the prompt's own rules.
 *
 * The rules are the one text in the prompt the answer may never come from: a
 * model that cannot satisfy them returns them instead, and the result reads like
 * a commit message while describing nothing that was staged. Every phrase of
 * "Many changes, rank, describe top one only" and "run lint and test before
 * push" arrived that way, and the grounding checks let them through because both
 * are fluent English about software.
 *
 * Matched on words rather than characters because the copy is rarely exact: the
 * model drops a clause, swaps a colon for a comma, or lifts half of an example.
 * `tokenize` removes the punctuation and filler that differ, so the run that
 * survives is the wording itself.
 */
export function isCopiedFromInstructions(text, instructions) {
  if (!instructions) {
    return false;
  }

  const tokens = tokenize(String(text || "").replace(/^\s*[-*]\s*/, ""));

  if (tokens.length < INSTRUCTION_RUN_WORDS) {
    return false;
  }

  const runs = instructionRuns(instructions);

  for (let at = 0; at + INSTRUCTION_RUN_WORDS <= tokens.length; at += 1) {
    if (runs.has(wordRun(tokens, at))) {
      return true;
    }
  }

  return false;
}

// Every run of five words in the rules, built once per prompt. The rules change
// only between attempts, so one cached set serves every line of a message.
function instructionRuns(instructions) {
  if (cachedInstructionRuns.source === instructions) {
    return cachedInstructionRuns.runs;
  }

  const tokens = tokenize(instructions);
  const runs = new Set();

  for (let at = 0; at + INSTRUCTION_RUN_WORDS <= tokens.length; at += 1) {
    runs.add(wordRun(tokens, at));
  }

  cachedInstructionRuns = { runs, source: instructions };

  return runs;
}

function wordRun(tokens, at) {
  return tokens.slice(at, at + INSTRUCTION_RUN_WORDS).join(" ");
}

/**
 * The first file the text names that is not staged, or "" when every file it
 * names was.
 *
 * A path in a message is a checkable claim, and it is the one hallucination that
 * costs the reader the most: `git show` opens on a file the message never
 * mentions. The subject that started this check, "docs: update README.md", was
 * written for a change with no README in it - the model had lifted the filename
 * out of an example in its own instructions. Existing checks could not see it
 * because they ask what the description does with a staged path, and this path
 * was not staged at all.
 */
export function namesUnstagedFile(text, stagedFiles = []) {
  if (stagedFiles.length === 0) {
    return "";
  }

  const names = stagedPathNames(stagedFiles);
  const paths = [...names];

  for (const word of String(text || "").split(/\s+/)) {
    const mention = word
      .toLocaleLowerCase()
      .replace(/^[`'"([{<*-]+/, "")
      .replace(/[`'")\]}>.,;:!?]+$/, "");

    if (
      !mention ||
      LIBRARY_NAMES.has(mention) ||
      (!mention.includes("/") && !FILE_EXTENSION.test(mention)) ||
      names.has(mention)
    ) {
      continue;
    }

    // A directory is a real reference to the change: "src/output" covers every
    // staged file under it, and the model was given the paths to say so.
    const covered = paths.some(
      (path) => path.endsWith(`/${mention}`) || path.startsWith(`${mention}/`),
    );

    if (!covered) {
      return mention;
    }
  }

  return "";
}

export function flattenForSearch(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A diff flattened for the copy check, with the markup that a sentence in the
 * diff is wrapped in removed: the leading `+`/`-`, and comment openers.
 *
 * Without this the check only catches prose that sits on one line of code. A
 * docstring copied out of the diff arrives as "Staged files with the
 * most-changed first, each carrying its changed-line count" while the diff holds
 * "+ * Staged files with the most-changed first, each carrying its changed-line"
 * then "+ * count." - the same sentence, and no substring of it matches.
 */
export function flattenDiffForSearch(diff) {
  return flattenForSearch(
    String(diff || "")
      .split("\n")
      .map((line) =>
        line
          .replace(/^[+-](?![+-])/, "")
          .replace(/^\s*(?:\/\/+|\/\*+|\*+\/?|#+|--)\s?/, " "),
      )
      .join("\n"),
  );
}

/**
 * True when the description lists the files that changed instead of saying what
 * changed in them: "update package.json and pnpm-lock.yaml".
 *
 * A reader can already see the file list in `git show`. The subject exists to
 * say what the edit did, so a description that survives only on filenames has
 * said nothing. Anything left over after removing the paths and a leading
 * generic verb counts as saying something.
 */
/**
 * Every way a staged file can be referred to: its path, its filename, and its
 * filename without the extension, so that `README.md`, `docs/README.md` and
 * "readme" all point at the same file.
 */
function stagedPathNames(stagedFiles = []) {
  const names = new Set();

  for (const file of stagedFiles) {
    for (const path of [file?.path, file?.previousPath]) {
      if (!path) {
        continue;
      }

      const lower = path.toLocaleLowerCase();
      const base = lower.split(/[\\/]/).at(-1) || "";

      names.add(lower);
      names.add(base);
      names.add(base.replace(/\.[a-z0-9]+$/, ""));
    }
  }

  names.delete("");

  return names;
}

/**
 * True when the text says a staged file was worked on instead of saying what the
 * work was: "update the README.md file to include new scripts".
 *
 * A path is where an edit happened, never what it did, and the reader already
 * has the path from `git show`. A line built around it spends itself on the one
 * fact that was free and leaves the reader to open the diff for the substance,
 * which is the whole thing the message existed to save them. "document pre-push
 * and validate scripts" costs the same characters and says it.
 *
 * Only a target written as a path counts, so the dot or the slash has to be
 * there. A staged `config.mjs` otherwise turns "change config timeout from 30s
 * to 60s" into a rejection, and that sentence names both sides of the edit -
 * exactly what this check exists to ask for. The bare-name case, "update
 * readme", has nothing else in it and `namesOnlyFiles` already refuses it.
 */
export function namesFileAsObject(text, stagedFiles = []) {
  const match = CONTAINER_VERB.exec(
    String(text || "")
      .replace(/^\s*[-*]\s*/, "")
      .trim(),
  );

  if (!match) {
    return false;
  }

  const target = match.groups.target
    .toLocaleLowerCase()
    .replace(/^[`'"([]+/, "")
    .replace(/[`'")\].,;:!?]+$/, "");

  return /[./]/.test(target) && stagedPathNames(stagedFiles).has(target);
}

function namesOnlyFiles(description, stagedFiles) {
  if (stagedFiles.length === 0) {
    return false;
  }

  const paths = stagedPathNames(stagedFiles);
  const remaining = tokenize(description)
    .filter((token) => !paths.has(token))
    .filter((token) => !GENERIC_BODY_WORDS.has(token))
    .filter((token) => token.length > 2);

  return (
    remaining.length === 0 &&
    tokenize(description).some((token) => paths.has(token))
  );
}

function normalizeSubject(
  value,
  {
    allowScope = true,
    instructions = "",
    knownFiles = [],
    requiredType,
    searchableDiff = "",
    stagedFiles = [],
  } = {},
) {
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
    /^(?:add|change|create|extend|include|introduce|modify|update|write) (?:a |the )?tests?\b/i.test(
      description,
    )
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

  const weakVerb = WEAK_VERB.exec(description);

  if (weakVerb) {
    throw new InvalidModelOutputError(
      `"${weakVerb[0]}" does not say what changed; ` +
        "name the concrete edit in the diff instead.",
    );
  }

  if (namesOnlyFiles(description, stagedFiles)) {
    throw new InvalidModelOutputError(
      `"${description}" only lists the files that changed; ` +
        "say what the change did to them.",
    );
  }

  if (namesFileAsObject(description, stagedFiles)) {
    throw new InvalidModelOutputError(
      `"${description}" names the file that was touched, not the change; ` +
        "say what is different inside it, and name both sides of anything " +
        "that was replaced.",
    );
  }

  if (isCopiedFromDiff(description, searchableDiff)) {
    throw new InvalidModelOutputError(
      `"${description}" is text copied out of the diff, not a description ` +
        "of it; say what the change does in your own words.",
    );
  }

  if (hasUnfilledSlot(description)) {
    throw new InvalidModelOutputError(
      `"${description}" leaves a <placeholder> from an example unfilled; ` +
        "replace it with the identifier, value or behavior from the diff.",
    );
  }

  if (isCopiedFromInstructions(description, instructions)) {
    throw new InvalidModelOutputError(
      `"${description}" is wording copied out of these rules, not a ` +
        "description of the staged change; describe the diff instead.",
    );
  }

  const unstagedFile = namesUnstagedFile(description, knownFiles);

  if (unstagedFile) {
    throw new InvalidModelOutputError(
      `"${unstagedFile}" is not one of the staged files; describe a file ` +
        "that the change actually touched.",
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

  // "Improve concurrency in the model test by adding a test ..." A line whose
  // verb only announces an intention is padding, the same way it is in a
  // subject, and it always wraps a change the subject already named.
  if (
    body
      .split("\n")
      .some((line) => WEAK_VERB.test(line.replace(/^[-*]\s*/, "")))
  ) {
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

  // A body exists to carry the tasks the subject had no room for. A single line
  // that covers most of the subject's words is not another task, it is this task
  // again at greater length - and the file paths it adds are detail about the
  // same edit, not a second edit, so they must not buy it a pass:
  //
  //   fix(mapping): fix incorrect file path lookup
  //   Replaced incorrect file path lookup with the correct path to
  //   `files/mapping` in `src/files/index.js`.
  //
  // Other tasks arrive as their own "- " items. Prose is therefore either extra
  // context, which is worth keeping, or the subject a second time, which is not.
  // Total overlap does not separate the two: the example above shares four of
  // six words with its subject, because it swaps one verb for a synonym and adds
  // a path, and prose that supplies a real migration note may share none. What
  // separates them is a repeated run of the subject's own words.
  const listsTasks = body
    .split("\n")
    .some((line) => /^\s*[-*]\s+\S/.test(line));

  if (!listsTasks && repeatsSubjectPhrase(subjectTokens, bodyTokens)) {
    return true;
  }

  return (
    subjectCoverage >= 0.75 &&
    (startsWithBoilerplate || novelBodyTokens.length <= 1)
  );
}

/**
 * True when the body contains three of the subject's words in a row.
 *
 * Three is long enough that ordinary prose does not hit it by chance and short
 * enough to catch a restatement: "fix incorrect file path lookup" reappearing as
 * "Replaced incorrect file path lookup with the correct path to ...". Stemming is
 * shared with the coverage check, so a plural or a tense does not hide the run.
 */
function repeatsSubjectPhrase(subjectTokens, bodyTokens, length = 3) {
  if (subjectTokens.length < length || bodyTokens.length < length) {
    return false;
  }

  for (let start = 0; start + length <= subjectTokens.length; start += 1) {
    const phrase = subjectTokens.slice(start, start + length);

    for (let at = 0; at + length <= bodyTokens.length; at += 1) {
      if (
        phrase.every((token, offset) =>
          tokensMatch(token, bodyTokens[at + offset]),
        )
      ) {
        return true;
      }
    }
  }

  return false;
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
