import { readFile } from "node:fs/promises";

const help = `chill-commit

Generate concise Git commit messages with a small local language model.

Usage:
  chill-commit [options]

Options:
  -h, --help     Show help
  -v, --version  Show version
`;

export async function run(args, io = process) {
  if (args.includes("--version") || args.includes("-v")) {
    const packageUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
    io.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout.write(help);
    return 0;
  }

  io.stderr.write("Commit generation is not implemented yet.\n");
  return 1;
}
