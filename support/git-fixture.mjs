import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createRepository(t, { initialCommit = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "augit-git-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--quiet");
  await git(directory, "config", "user.name", "Augit Test");
  await git(directory, "config", "user.email", "augit@example.test");

  if (initialCommit) {
    await writeFile(join(directory, "README.md"), "# fixture\n");
    await git(directory, "add", "README.md");
    await git(
      directory,
      "commit",
      "--quiet",
      "-m",
      "chore: initialize fixture",
    );
  }

  return directory;
}

export async function git(cwd, ...args) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
}
