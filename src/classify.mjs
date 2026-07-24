const DOCUMENTATION_PATH =
  /(^|\/)(?:docs?\/|readme(?:\.[^/]+)?$|changelog(?:\.[^/]+)?$|contributing(?:\.[^/]+)?$)|\.(?:md|mdx|rst|adoc)$/i;
const TEST_PATH =
  /(^|\/)(?:__tests__|test|tests)(\/|$)|\.(?:test|spec)\.[^/]+$/i;
const CI_PATH =
  /(^|\/)(?:\.github\/workflows|\.circleci)(\/|$)|(^|\/)(?:\.gitlab-ci\.yml|azure-pipelines\.yml)$/i;
const SOURCE_PATH = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h)$/i;

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

  if (/^\+(?!\+\+).*(?:["'`])--[a-z0-9][a-z0-9-]*/im.test(context.diff || "")) {
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

  for (const match of diff.matchAll(
    /^\+(?!\+\+).*?(--[a-z0-9][a-z0-9-]*)/gim,
  )) {
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

  if (/\bPromise\.all\b|\bconcurren(?:t|cy)\b/i.test(diff)) {
    add("concurrency");
  }

  if (/\bmatrix\b/i.test(diff)) {
    add("matrix");
  }

  if (/\bNode(?:\.js)?\b/i.test(diff)) {
    add("Node.js");
  }

  if (/\bpnpm\b/i.test(diff)) {
    add("pnpm");
  }

  if (/\brm\s*\(|\bdelete\b|\bdeletions?\b|\bremove\b/i.test(diff)) {
    add("deletion");
  }

  if (looksLikeCodeRelocation(diff)) {
    add("extraction");
  }

  return concepts.slice(0, 6);
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
