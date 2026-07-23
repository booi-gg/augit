import { readFile } from "node:fs/promises";

import {
  BUILT_IN_MODEL,
  ensureBuiltInModel,
  getBuiltInModelPath,
} from "./model.mjs";

const help = `gikum

Generate concise Git commit messages with a small local language model.

Usage:
  gikum [options]

Options:
      --download-model  Download the built-in model for offline use
  -h, --help            Show help
  -v, --version         Show version
`;

export { BUILT_IN_MODEL, ensureBuiltInModel, getBuiltInModelPath };

export async function run(
  args,
  io = process,
  { ensureModel = ensureBuiltInModel } = {},
) {
  if (args.includes("--version") || args.includes("-v")) {
    const packageUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
    io.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (args.length === 1 && args[0] === "--download-model") {
    let lastProgress = -1;

    io.stderr.write(`Preparing ${BUILT_IN_MODEL.name}...\n`);

    try {
      const result = await ensureModel({
        onProgress({ downloaded, total }) {
          const progress = Math.floor((downloaded / total) * 100);
          const milestone = Math.floor(progress / 5) * 5;

          if (milestone > lastProgress && milestone < 100) {
            lastProgress = milestone;
            io.stderr.write(`Downloading built-in model: ${milestone}%\n`);
          }
        },
      });
      const state = result.downloaded ? "downloaded" : "already cached";

      io.stdout.write(`Built-in model ready (${state}): ${result.path}\n`);
      return 0;
    } catch (error) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout.write(help);
    return 0;
  }

  io.stderr.write("Commit generation is not implemented yet.\n");
  return 1;
}
