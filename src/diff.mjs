/**
 * Splitting a unified diff into per-file and per-hunk pieces.
 *
 * Both the single prompt and the per-file summary pass need the same view of
 * where one file's changes end and the next begin, and both rank files by how
 * much they changed. Counting it twice invites the two orderings to disagree.
 */

const FILE_HEADER = /^diff --git a\/(?<previousPath>.+?) b\/(?<path>.+)$/;

/**
 * The diff as one entry per file, each carrying its own changed-line count.
 *
 * Input that carries no `diff --git` header at all - a hand-written fixture, a
 * single hunk pasted on its own - comes back as one pathless entry rather than
 * nothing, because it is still a change worth describing.
 */
export function splitDiffByFile(diff) {
  const entries = [];

  for (const line of String(diff || "").split("\n")) {
    const header = FILE_HEADER.exec(line);

    if (header || entries.length === 0) {
      entries.push({
        path: header?.groups.path,
        previousPath: header?.groups.previousPath,
        diff: line,
      });
    } else {
      entries[entries.length - 1].diff += `\n${line}`;
    }
  }

  if (entries.length === 1 && !entries[0].diff.trim()) {
    return [];
  }

  return entries.map((entry) => ({
    ...entry,
    changedLines: countChangedLines(entry.diff),
  }));
}

/**
 * Files with the most-changed first, ties broken by the order Git gave them.
 *
 * Git emits files in path order, so a one-line manifest edit arrives ahead of a
 * rewritten source file. Left in that order the smallest edit is both the first
 * thing the model reads and, once a shared budget has been applied, the only one
 * it can read end to end.
 */
export function byChurnDescending(left, right) {
  return right.changedLines - left.changedLines;
}

/**
 * A file's diff as its header plus one entry per hunk.
 *
 * Used when a single file changed too much to fit in one prompt. Splitting on
 * hunk boundaries keeps each piece syntactically whole, where a byte cut leaves
 * the model reading half an expression.
 */
export function splitFileIntoHunks(fileDiff) {
  const lines = String(fileDiff || "").split("\n");
  const header = [];
  const hunks = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      hunks.push(line);
    } else if (hunks.length === 0) {
      header.push(line);
    } else {
      hunks[hunks.length - 1] += `\n${line}`;
    }
  }

  return { header: header.join("\n"), hunks };
}

export function countChangedLines(diff) {
  let changed = 0;

  for (const line of String(diff || "").split("\n")) {
    if (
      /^[+-]/.test(line) &&
      !line.startsWith("+++") &&
      !line.startsWith("---")
    ) {
      changed += 1;
    }
  }

  return changed;
}
