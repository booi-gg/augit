import { createInterface } from "node:readline";

export async function promptForNoStagedChanges({
  input = process.stdin,
  output = process.stderr,
} = {}) {
  if (!input?.isTTY || !output?.isTTY) {
    return null;
  }

  const readline = createInterface({ input, crlfDelay: Infinity });

  output.write(
    [
      "No staged changes found.",
      "  1) Stage all changes and continue",
      "  2) Cancel",
      "Select an option [1-2] (default: 2): ",
    ].join("\n"),
  );

  try {
    for await (const line of readline) {
      const answer = line.trim().toLowerCase();

      if (answer === "1" || answer === "s" || answer === "stage") {
        return "stage";
      }

      if (
        answer === "" ||
        answer === "2" ||
        answer === "c" ||
        answer === "cancel"
      ) {
        return "cancel";
      }

      output.write("Please enter 1 to stage or 2 to cancel: ");
    }

    return "cancel";
  } finally {
    readline.close();
  }
}
