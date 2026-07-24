import { emitKeypressEvents } from "node:readline";

const generatedCommitChoices = [
  {
    label: "Commit",
    value: "commit",
  },
  {
    label: "Generate again",
    value: "regenerate",
  },
  {
    label: "Cancel",
    value: "cancel",
  },
];
const noStagedChangesChoices = [
  {
    label: "Stage all changes and continue",
    value: "stage",
  },
  {
    label: "Cancel",
    value: "cancel",
  },
];

export async function promptForGeneratedCommit({
  input = process.stdin,
  message,
  output = process.stderr,
} = {}) {
  return promptForChoice({
    choices: generatedCommitChoices,
    initialSelection: 0,
    input,
    introduction:
      `Generated commit message:\n\n${message}\n\n` +
      "Use the UP and DOWN arrow keys to select, then press Enter.\n",
    output,
  });
}

export async function promptForNoStagedChanges({
  input = process.stdin,
  output = process.stderr,
} = {}) {
  return promptForChoice({
    choices: noStagedChangesChoices,
    initialSelection: noStagedChangesChoices.length - 1,
    input,
    introduction:
      "No staged changes found.\n" +
      "Use the UP and DOWN arrow keys to select, then press Enter.\n",
    output,
  });
}

async function promptForChoice({
  choices,
  initialSelection,
  input,
  introduction,
  output,
}) {
  if (!input?.isTTY || !output?.isTTY) {
    return null;
  }

  let selectedIndex = initialSelection;
  const wasPaused = input.isPaused?.() ?? true;
  const wasRaw = Boolean(input.isRaw);

  emitKeypressEvents(input);

  output.write(introduction);
  renderChoices(output, choices, selectedIndex);

  return new Promise((resolve, reject) => {
    const finish = (value) => {
      cleanup();
      resolve(value);
    };
    const onEnd = () => finish("cancel");
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onKeypress = (_character, key = {}) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        finish("cancel");
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finish(choices[selectedIndex].value);
        return;
      }

      const previousIndex = selectedIndex;

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (key.name === "down") {
        selectedIndex = Math.min(choices.length - 1, selectedIndex + 1);
      }

      if (selectedIndex !== previousIndex) {
        renderChoices(output, choices, selectedIndex, { redraw: true });
      }
    };
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.off("end", onEnd);
      input.off("error", onError);

      if (!wasRaw && typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }

      if (wasPaused) {
        input.pause?.();
      }
    };

    input.on("keypress", onKeypress);
    input.once("end", onEnd);
    input.once("error", onError);

    if (!wasRaw && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }

    input.resume?.();
  });
}

function renderChoices(
  output,
  choices,
  selectedIndex,
  { redraw = false } = {},
) {
  if (redraw) {
    output.write(`\u001B[${choices.length}A`);
  }

  choices.forEach(({ label }, index) => {
    const marker = index === selectedIndex ? "❯" : " ";
    output.write(`\r\u001B[2K${marker} ${label}\n`);
  });
}
