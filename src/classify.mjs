const DOCUMENTATION_PATH =
  /(^|\/)(?:docs?\/|readme(?:\.[^/]+)?$|changelog(?:\.[^/]+)?$|contributing(?:\.[^/]+)?$)|\.(?:md|mdx|rst|adoc)$/i;
const TEST_PATH =
  /(^|\/)(?:__tests__|test|tests)(\/|$)|\.(?:test|spec)\.[^/]+$/i;
const CI_PATH =
  /(^|\/)(?:\.github\/workflows|\.circleci)(\/|$)|(^|\/)(?:\.gitlab-ci\.yml|azure-pipelines\.yml)$/i;
const SOURCE_PATH = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h)$/i;
// A long option on an added line. The lookbehind skips `diff --git`, which
// appears whenever a fixture or test embeds diff text of its own.
const ADDED_FLAG = /^\+(?!\+\+).*?(?<!diff )(--[a-z0-9][a-z0-9-]*)/im;
const ADDED_FLAGS = new RegExp(ADDED_FLAG.source, "gim");

export function inferRequiredType(context) {
  const files = context.files || [];
  const paths = files.map((file) => file.path);

  if (paths.length === 0) {
    return undefined;
  }

  if (paths.every((path) => DOCUMENTATION_PATH.test(path))) {
    return "docs";
  }

  if (paths.every((path) => TEST_PATH.test(path))) {
    return "test";
  }

  if (paths.every((path) => CI_PATH.test(path))) {
    return "ci";
  }

  if (looksLikeCodeRelocation(context.diff || "")) {
    return "refactor";
  }

  // A new command-line flag is a new capability, but only when the file that
  // gained it ships behavior. A test that asserts on a flag is still a test,
  // and a fixture holding a diff header is not a flag at all.
  if (ADDED_FLAG.test(flagEvidence(context.diff || ""))) {
    return "feat";
  }

  if (looksLikeDefensiveFix(context.diff || "")) {
    return "fix";
  }

  if (
    files.every((file) => file.status === "A" && SOURCE_PATH.test(file.path))
  ) {
    return "feat";
  }

  return undefined;
}

export function extractKeyConcepts(context) {
  const diff = context.diff || "";
  const concepts = [];
  const add = (value) => {
    const normalized = value.trim();

    if (
      normalized &&
      !concepts.some(
        (concept) =>
          concept.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    ) {
      concepts.push(normalized);
    }
  };

  for (const file of context.files || []) {
    if (file.status === "A" && SOURCE_PATH.test(file.path)) {
      const filename = file.path.split(/[\\/]/).at(-1) || "";
      const stem = filename.replace(/\.[^.]+$/, "");

      if (stem && !/^(?:index|main|mod)$/i.test(stem)) {
        add(stem);
      }
    }
  }

  for (const match of flagEvidence(diff).matchAll(ADDED_FLAGS)) {
    add(match[1]);
  }

  for (const match of diff.matchAll(
    /^\+(?!\+\+).*\b(?:test|it)\(\s*["'`]([^"'`]{4,80})["'`]/gim,
  )) {
    add(match[1]);
  }

  for (const match of diff.matchAll(/^\+(?!\+\+)\s*#{1,4}\s+(.{2,60})$/gm)) {
    add(match[1]);
  }

  for (const match of diff.matchAll(
    /^\+(?!\+\+).*\bif\s*\(\s*!([^)\n]+)\)/gim,
  )) {
    const identifiers = match[1].match(/[A-Za-z_$][\w$]*/g);

    if (identifiers?.length) {
      add(`missing ${identifiers.at(-1)}`);
    }
  }

  const addedText = extractChangedCode(diff, "+").join("\n");

  if (/\bPromise\.all\b|\bconcurren(?:t|cy)\b/i.test(addedText)) {
    add("concurrency");
  }

  if (/\bmatrix\b/i.test(addedText)) {
    add("matrix");
  }

  if (/\bNode(?:\.js)?\b/i.test(addedText)) {
    add("Node.js");
  }

  if (/\bpnpm\b/i.test(addedText)) {
    add("pnpm");
  }

  if (/\brm\s*\(|\bdelete\b|\bdeletions?\b|\bremove\b/i.test(addedText)) {
    add("deletion");
  }

  if (looksLikeCodeRelocation(diff)) {
    add("extraction");
  }

  return concepts.slice(0, 6);
}

/**
 * The parts of `diff` that belong to files which ship behavior.
 *
 * Test files quote the things they assert on: flags, sample commit messages,
 * whole diffs. Reading those quotes as facts about the change is how a test that
 * merely mentions `--dry-run` gets classified as a new feature.
 */
function shippingCode(diff) {
  const sections = [];
  let keep = true;

  for (const line of String(diff).split("\n")) {
    const header = /^diff --git a\/(.+?) b\//.exec(line);

    if (header) {
      keep = !TEST_PATH.test(header[1]);
    }

    if (keep) {
      sections.push(line);
    }
  }

  return sections.join("\n");
}

/**
 * Added lines that could introduce a flag: shipping files only, comments
 * dropped. A comment mentioning `--dry-run` explains a flag; it does not add
 * one, and neither does a docstring quoting one.
 */
function flagEvidence(diff) {
  return shippingCode(diff)
    .split("\n")
    .filter((line) => !/^\+(?!\+\+)\s*(?:\/\/|\/\*|\*|#|--\s)/.test(line))
    .join("\n");
}

function looksLikeCodeRelocation(diff) {
  const removed = extractChangedCode(diff, "-");
  const added = extractChangedCode(diff, "+");

  if (removed.length < 2 || added.length < 2) {
    return false;
  }

  const addedLines = new Set(added);
  const overlap = removed.filter((line) => addedLines.has(line)).length;

  return overlap >= 2 && overlap / removed.length >= 0.6;
}

function looksLikeDefensiveFix(diff) {
  return (
    /^\+(?!\+\+).*\bif\s*\(\s*![^)\n]+\)/im.test(diff) &&
    /^-(?!---).*\breturn\b.*\.[A-Za-z_$][\w$]*/im.test(diff)
  );
}

function extractChangedCode(diff, prefix) {
  return diff
    .split("\n")
    .filter(
      (line) =>
        line.startsWith(prefix) &&
        !line.startsWith(`${prefix}${prefix}${prefix}`),
    )
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length >= 4 && !/^[{}[\]();,]+$/.test(line));
}
