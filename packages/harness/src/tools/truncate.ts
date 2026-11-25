export const MAX_TOOL_OUTPUT = 30_000;

// Keep head and tail of long output
export function truncateOutput(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  const removed = text.length - half * 2;
  return `${text.slice(0, half)}\n\n[... ${removed} characters truncated ...]\n\n${text.slice(-half)}`;
}
