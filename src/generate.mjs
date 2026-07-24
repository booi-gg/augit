import { extractKeyConcepts, inferRequiredType } from "./classify.mjs";
import { collectStagedChanges } from "./git.mjs";
import { ensureBuiltInModel } from "./model.mjs";
import { InvalidModelOutputError, normalizeCommitMessage } from "./output.mjs";
import { buildCommitPromptDetails, buildRepairPrompt } from "./prompt.mjs";
import { createNodeLlamaRuntime } from "./runtime.mjs";
import { sanitizeGitContext } from "./sanitize.mjs";

export async function generateCommit({
  collector = collectStagedChanges,
  createRuntime = createNodeLlamaRuntime,
  cwd = process.cwd(),
  ensureModel = ensureBuiltInModel,
  maxDiffBytes,
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
  const {
    prompt: basePrompt,
    diffTruncated: promptDiffTruncated,
    filesTruncated: promptFilesTruncated,
  } = buildCommitPromptDetails(safeContext, {
    keyConcepts,
    previousMessages,
    requiredType,
  });

  onStatus({ phase: "loading-model" });
  const model = await ensureModel({ onProgress: onModelProgress });
  const ownsRuntime = !runtime;
  const activeRuntime = runtime || (await createRuntime());

  try {
    let prompt = basePrompt;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      onStatus({ phase: "generating", attempt });
      const output = await activeRuntime.generate({
        modelPath: model.path,
        prompt,
        signal,
      });

      try {
        const normalized = normalizeCommitMessage(output, { requiredType });

        if (previousMessageSet.has(normalized.message)) {
          throw new InvalidModelOutputError(
            "message repeats a previous proposal.",
          );
        }

        const usage = activeRuntime.getUsage?.();

        return {
          ...normalized,
          input: {
            diffTruncated: safeContext.diffTruncated || promptDiffTruncated,
            filesTruncated: safeContext.filesTruncated || promptFilesTruncated,
            redactionCount: safeContext.redactionCount,
            requiredType,
            keyConcepts,
          },
          model: model.model,
          ...(usage ? { usage } : {}),
        };
      } catch (error) {
        if (!(error instanceof InvalidModelOutputError) || attempt === 2) {
          throw error;
        }

        prompt = buildRepairPrompt(basePrompt, error.message);
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
