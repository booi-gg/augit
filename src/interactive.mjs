import { emitKeypressEvents } from "node:readline";

const ANSI = Object.freeze({
  blue: 34,
  bold: 1,
  cyan: 36,
  dim: 2,
  gray: 90,
  green: 32,
  lightBlue: 94,
  magenta: 35,
  orange: "38;5;208",
  red: 31,
  yellow: 33,
});
const TYPE_COLORS = Object.freeze({
  build: ANSI.yellow,
  chore: ANSI.gray,
  ci: ANSI.blue,
  docs: ANSI.blue,
  feat: ANSI.green,
  fix: ANSI.red,
  perf: ANSI.magenta,
  refactor: ANSI.cyan,
  revert: ANSI.red,
  style: ANSI.magenta,
  test: ANSI.yellow,
});
const generatedCommitChoices = [
  {
    color: ANSI.green,
    keys: ["y"],
    label: "Commit",
    value: "commit",
  },
  {
    color: ANSI.yellow,
    keys: ["r"],
    label: "Generate again",
    value: "regenerate",
  },
  {
    color: ANSI.red,
    keys: ["c", "n"],
    label: "Cancel",
    value: "cancel",
  },
];
const noStagedChangesChoices = [
  {
    color: ANSI.green,
    keys: ["s", "a", "y"],
    label: "Stage all changes and continue",
    value: "stage",
  },
  {
    color: ANSI.red,
    keys: ["c", "n"],
    label: "Cancel",
    value: "cancel",
  },
];

export async function promptForGeneratedCommit({
  color,
  input = process.stdin,
  message,
  output = process.stderr,
} = {}) {
  const useColor = color ?? supportsColor(output);

  return promptForChoice({
    choices: generatedCommitChoices,
    initialSelection: 0,
    input,
    introduction:
      `\n${formatCommitMessage(message, { color: useColor })}\n\n` +
      "Use the [UP] and [DOWN] arrow keys to select, then press [ENTER].\n",
    output,
    useColor,
  });
}

export function formatChangesStatus(
  found,
  { color, output = process.stderr } = {},
) {
  const message = found ? "Changes found." : "No staged changes found.";
  const statusColor = found ? ANSI.lightBlue : ANSI.orange;

  return paint(message, [statusColor], color ?? supportsColor(output));
}

export async function promptForNoStagedChanges({
  color,
  input = process.stdin,
  output = process.stderr,
} = {}) {
  const useColor = color ?? supportsColor(output);

  return promptForChoice({
    choices: noStagedChangesChoices,
    combineMarkerAndLabel: true,
    initialSelection: 0,
    input,
    introduction:
      "Use the [UP] and [DOWN] arrow keys to select, then press [ENTER].\n",
    output,
    useColor,
  });
}

async function promptForChoice({
  choices,
  combineMarkerAndLabel = false,
  initialSelection,
  input,
  introduction,
  output,
  useColor,
}) {
  if (!input?.isTTY || !output?.isTTY) {
    return null;
  }

  let selectedIndex = initialSelection;
  const wasRaw = Boolean(input.isRaw);

  emitKeypressEvents(input);

  output.write(introduction);
  renderChoices(output, choices, selectedIndex, {
    combineMarkerAndLabel,
    useColor,
  });

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
    const onKeypress = (character, key = {}) => {
      if (
        (key.ctrl && key.name === "c") ||
        key.name === "escape" ||
        key.name === "q"
      ) {
        finish("cancel");
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finish(choices[selectedIndex].value);
        return;
      }

      const previousIndex = selectedIndex;

      if (key.name === "up" || key.name === "k") {
        selectedIndex = (selectedIndex + choices.length - 1) % choices.length;
      } else if (
        key.name === "down" ||
        key.name === "j" ||
        key.name === "tab"
      ) {
        selectedIndex = (selectedIndex + 1) % choices.length;
      } else {
        const shortcut = choices.find(({ keys = [] }) =>
          keys.includes(character?.toLocaleLowerCase()),
        );

        if (shortcut) {
          finish(shortcut.value);
          return;
        }
      }

      if (selectedIndex !== previousIndex) {
        renderChoices(output, choices, selectedIndex, {
          combineMarkerAndLabel,
          redraw: true,
          useColor,
        });
      }
    };
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.off("end", onEnd);
      input.off("error", onError);

      if (!wasRaw && typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }

      input.pause?.();
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
  { redraw = false, useColor = false } = {},
) {
  if (redraw) {
    output.write(`\u001B[${choices.length}A`);
  }

  choices.forEach(({ color, label }, index) => {
    const selected = index === selectedIndex;
    const marker = selected ? paint("❯", [ANSI.bold, color], useColor) : " ";
    const styledLabel = selected
      ? paint(label, [ANSI.bold, color], useColor)
      : paint(label, [ANSI.dim], useColor);

    output.write(`\r\u001B[2K${marker} ${styledLabel}\n`);
  });
}

function formatCommitMessage(message, { color }) {
  const [subject = "", ...bodyLines] = String(message)
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const match =
    /^(?<type>[a-z]+)(?<scope>\([^)]+\))?(?<breaking>!)?(?<separator>: )(?<description>.+)$/.exec(
      subject,
    );
  let formattedSubject = subject;

  if (match) {
    const typeColor = TYPE_COLORS[match.groups.type] || ANSI.gray;

    formattedSubject = paint(subject, [ANSI.bold, typeColor], color);
  }

  if (bodyLines.length === 0) {
    return formattedSubject;
  }

  const body = bodyLines.join("\n");

  return `${formattedSubject}\n${paint(body, [ANSI.gray], color)}`;
}

function paint(value, codes, enabled) {
  if (!enabled || !value) {
    return value;
  }

  return `\u001B[${codes.join(";")}m${value}\u001B[0m`;
}

function supportsColor(output) {
  return (
    Boolean(output?.isTTY) &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb"
  );
}
