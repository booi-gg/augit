import { assembleCommitFromSummaries } from "./assemble.mjs";
import { extractKeyConcepts, inferRequiredType } from "./classify.mjs";
import { collectStagedChanges } from "./git.mjs";
import { ensureBuiltInModel } from "./model.mjs";
import { InvalidModelOutputError, normalizeCommitMessage } from "./output.mjs";
import {
  buildCommitPromptDetails,
  buildRepairPrompt,
  buildSummaryCommitPrompt,
} from "./prompt.mjs";
import {
  createNodeLlamaRuntime,
  ModelOutputTruncatedError,
} from "./runtime.mjs";
import { sanitizeGitContext } from "./sanitize.mjs";
import { planSummaryUnits, summarizeChangedFiles } from "./summarize.mjs";

const DIVERSIFY_TEMPERATURE = 0.8;
const MAX_ATTEMPTS = 3;
// A subject and a body fit in far fewer tokens than this. The headroom is so a
// rambling answer finishes its JSON and can be rejected on its content, rather
// than arriving as a parse error that says only "too long".
const COMMIT_MAX_TOKENS = 512;

export async function generateCommit({
  allowScope = true,
  collector = collectStagedChanges,
  createRuntime = createNodeLlamaRuntime,
  cwd = process.cwd(),
  ensureModel = ensureBuiltInModel,
  maxDiffBytes,
  maxSummaryDiffBytes,
  onModelProgress = () => {},
  onStatus = () => {},
  previousMessages = [],
  runtime,
  sanitizeOptions = {},
  signal,
} = {}) {
  onStatus({ phase: "collecting" });
  const collected = await collector({ cwd, maxDiffBytes });
  const safeContext = sanitizeGitContext(collected, {
    ...sanitizeOptions,
    ...(maxDiffBytes === undefined ? {} : { maxDiffBytes }),
  });
  const requiredType = inferRequiredType(safeContext);
  const keyConcepts = extractKeyConcepts(safeContext);
  const previousMessageSet = new Set(
    previousMessages.map((message) =>
      String(message).replace(/\r\n?/g, "\n").trim(),
    ),
  );
  // More than one unit means the whole diff cannot reach the model in one
  // prompt. Reading each file on its own and ranking the results costs a call
  // per file, so a single-file change keeps the one-call path.
  const summarize =
    planSummaryUnits(safeContext.diff, { maxDiffChars: maxSummaryDiffBytes })
      .units.length > 1;

  onStatus({ phase: "loading-model" });
  const model = await ensureModel({ onProgress: onModelProgress });
  const ownsRuntime = !runtime;
  const activeRuntime = runtime || (await createRuntime());
  let fileSummaries;
  let summariesOmitted = 0;
  let promptDiffTruncated = false;
  let promptFilesTruncated = false;

  const describe = (normalized) => {
    const usage = activeRuntime.getUsage?.();

    return {
      ...normalized,
      input: {
        diffTruncated: safeContext.diffTruncated || promptDiffTruncated,
        filesTruncated: safeContext.filesTruncated || promptFilesTruncated,
        redactionCount: safeContext.redactionCount,
        requiredType,
        keyConcepts,
        ...(fileSummaries ? { fileSummaries, summariesOmitted } : {}),
      },
      model: model.model,
      ...(usage ? { usage } : {}),
    };
  };

  // Rebuilt on every retry so rejected subjects can be fed back as
  // `previousProposals`.
  const buildBasePrompt = (proposals) => {
    if (fileSummaries) {
      return buildSummaryCommitPrompt(
        {
          redactionCount: safeContext.redactionCount,
          repository: safeContext.repository,
          summaries: fileSummaries,
          unitsDropped: summariesOmitted,
        },
        { allowScope, keyConcepts, previousMessages: proposals, requiredType },
      );
    }

    const details = buildCommitPromptDetails(safeContext, {
      allowScope,
      keyConcepts,
      previousMessages: proposals,
      requiredType,
    });

    promptDiffTruncated = details.diffTruncated;
    promptFilesTruncated = details.filesTruncated;

    return details.prompt;
  };

  // The last resort when the model cannot turn the summaries into a message it
  // will accept. Ordering the tasks needs no language ability, and refusing to
  // answer at all after reading every file is worse than saying plainly what the
  // biggest edit was.
  const assembleFromSummaries = () => {
    if (!fileSummaries) {
      return null;
    }

    const assembled = assembleCommitFromSummaries(fileSummaries, {
      allowScope,
      requiredType,
      // Assembled or generated, a message meets the same bar. Without this the
      // fallback becomes the way vacuous subjects reach the user.
      validate: ({ subject, body }) => {
        try {
          normalizeCommitMessage(
            { subject, body },
            {
              allowScope,
              evidence: {
                diff: safeContext.diff,
                files: safeContext.files,
                keyConcepts,
                repository: safeContext.repository,
              },
              requiredType,
            },
          );

          return true;
        } catch {
          return false;
        }
      },
    });

    if (!assembled || previousMessageSet.has(assembled.message)) {
      return null;
    }

    return describe({ ...assembled, assembled: true });
  };

  try {
    if (summarize) {
      const summarized = await summarizeChangedFiles({
        diff: safeContext.diff,
        maxDiffChars: maxSummaryDiffBytes,
        modelPath: model.path,
        onProgress: (progress) =>
          onStatus({ phase: "summarizing", ...progress }),
        repository: safeContext.repository,
        runtime: activeRuntime,
        signal,
      });

      fileSummaries = summarized.summaries;
      summariesOmitted = summarized.unitsDropped;
    }

    let prompt = buildBasePrompt(previousMessages);
    // Subjects already rejected this run. Telling the model its answer was
    // invalid is not enough on its own; without naming the answer it tends to
    // return the same one, especially when the diff itself contains prose that
    // reads like a commit message.
    const rejectedSubjects = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const diversify = attempt > 1 || previousMessageSet.size > 0;
      let rawSubject;

      onStatus({ phase: "generating", attempt });

      try {
        const output = await activeRuntime.generate({
          maxTokens: COMMIT_MAX_TOKENS,
          modelPath: model.path,
          prompt,
          ...(diversify ? { seed: randomSeed() } : {}),
          signal,
          temperature: diversify ? DIVERSIFY_TEMPERATURE : 0,
        });
        rawSubject =
          typeof output?.subject === "string" ? output.subject.trim() : "";

        const normalized = normalizeCommitMessage(output, {
          allowScope,
          evidence: {
            diff: safeContext.diff,
            files: safeContext.files,
            keyConcepts,
            repository: safeContext.repository,
          },
          requiredType,
        });

        if (previousMessageSet.has(normalized.message)) {
          throw new InvalidModelOutputError(
            "message repeats a previous proposal.",
          );
        }

        return describe(normalized);
      } catch (error) {
        const isTruncated = error instanceof ModelOutputTruncatedError;
        const isInvalidOutput = error instanceof InvalidModelOutputError;

        if (!isTruncated && !isInvalidOutput) {
          throw error;
        }

        if (attempt === MAX_ATTEMPTS) {
          const assembled = assembleFromSummaries();

          if (assembled) {
            return assembled;
          }

          throw error;
        }

        if (rawSubject && !rejectedSubjects.includes(rawSubject)) {
          rejectedSubjects.push(rawSubject);
        }

        const retryBase = buildBasePrompt([
          ...previousMessages,
          ...rejectedSubjects,
        ]);

        prompt = isTruncated
          ? buildRepairPrompt(
              retryBase,
              "the previous response was cut off before it finished because it was too long. Write a noticeably shorter subject and a brief, concise body.",
            )
          : buildRepairPrompt(retryBase, error.message);
      }
    }

    throw new InvalidModelOutputError("generation attempts were exhausted.");
  } finally {
    if (ownsRuntime) {
      await activeRuntime.dispose?.();
    }
  }
}

export async function generateCommitMessage(options = {}) {
  return (await generateCommit(options)).message;
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
