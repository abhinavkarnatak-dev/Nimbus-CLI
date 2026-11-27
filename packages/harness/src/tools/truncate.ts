// About 7,500 tokens per tool output
export const MAX_TOOL_OUTPUT = 30_000;
// The end usually holds the error, so it gets more room
const HEAD_SHARE = 1 / 3;

const count = (n: number) => n.toLocaleString("en-US");

function cutNote(shown: string, savedAt: string | null): string {
  const where = savedAt
    ? `The full output is saved at ${savedAt}. Search it with grep or read parts of it with read_file.`
    : "The middle was left out.";
  return `[Output too long: showed ${shown}. ${where}]`;
}

// Keep the start and end, cut at whole lines
export function truncateOutput(
  text: string,
  max = MAX_TOOL_OUTPUT,
  savedAt: string | null = null,
): string {
  if (text.length <= max) return text;
  const headRoom = Math.floor(max * HEAD_SHARE);
  const tailRoom = max - headRoom;
  const lines = text.split("\n");

  let head = 0;
  let used = 0;
  while (head < lines.length && used + lines[head]!.length + 1 <= headRoom) {
    used += lines[head]!.length + 1;
    head++;
  }
  let tail = 0;
  used = 0;
  while (
    tail < lines.length - head &&
    used + lines[lines.length - 1 - tail]!.length + 1 <= tailRoom
  ) {
    used += lines[lines.length - 1 - tail]!.length + 1;
    tail++;
  }

  // One huge line (minified code): cut by characters instead
  if (head === 0 && tail === 0) {
    const shown = `the first ${count(headRoom)} and last ${count(tailRoom)} of ${count(text.length)} characters`;
    return `${text.slice(0, headRoom)}\n\n${cutNote(shown, savedAt)}\n\n${text.slice(-tailRoom)}`;
  }
  const shown = `the first ${count(head)} and last ${count(tail)} of ${count(lines.length)} lines`;
  return [
    ...lines.slice(0, head),
    "",
    cutNote(shown, savedAt),
    "",
    ...lines.slice(lines.length - tail),
  ].join("\n");
}
