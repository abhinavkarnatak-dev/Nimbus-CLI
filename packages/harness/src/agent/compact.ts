import type { HistoryItem } from "../model/types.js";
import { estimateTokens } from "./context.js";

// Compact automatically at this share of the context limit
export const COMPACT_AT = 0.8;
// Removing old outputs is enough if it gets below this
export const PRUNE_ENOUGH = 0.6;
// The newest tool outputs always stay whole
export const KEEP_RECENT_OUTPUTS = 4;
// Smaller outputs are not worth removing
export const PRUNE_MIN_TOKENS = 2000;
// /compact on a shorter chat would make it longer
export const MIN_COMPACT_TOKENS = 2000;

// Seen by the model: the request for a summary
export const COMPACT_REQUEST = `This conversation is getting too long to continue as it is. Write a summary that will
replace everything above this message. After this, the earlier messages, tool calls and
tool outputs will be gone and the summary is all you will have, so anything you leave out
is lost for good. Be complete and specific rather than short. Do not call any tools.

Use these sections, in this order:

1. The user's goal
   - What the user is trying to get done overall, and why, if they said.
   - Each request they made, in order, with their exact words where the wording matters.

2. Instructions and preferences
   - Every rule, preference or limit the user gave: coding style, libraries to use or
     avoid, files or things not to touch, how they want answers.
   - Corrections they made to your work, and what they did not like.
   - Facts the user shared about themselves, their project or their setup, for example
     their OS, tools, accounts, deadlines, team or how they test.

3. Work done
   - Features built, bugs fixed, and things removed or renamed, with file paths and the
     main functions, components or settings involved.
   - Files you created, changed or deleted, and what changed in each.
   - Commands you ran that mattered and what they showed: test results, build errors,
     versions.
   - Changes the user undid or asked you to revert.
   - Decisions taken and the reason for each, including options that were rejected.

4. Current state
   - What works now and how it was checked.
   - What is broken, half done or untested, with the exact error messages.
   - Anything still running in the background, such as dev servers.

5. Next steps
   - What you were doing right before this summary.
   - What the user asked for that is not done yet, and what you planned to do next.

6. Exact details
   - File paths, function and variable names, commands, error messages, numbers,
     versions, URLs and IDs that would be hard to find again. Copy them exactly.

Leave out greetings, small talk, tool output that no longer matters, and finished steps
that do not affect what comes next. If something was tried and dropped, say so in one
line so it is not tried again. Write plain text with these headings. Use hyphens, never
en or em dashes.`;

export function compactRequest(focus?: string): string {
  const extra = focus?.trim()
    ? `\n\nThe user asked you to pay special attention to the following, so keep every detail\nabout it: ${focus.trim()}`
    : "";
  return COMPACT_REQUEST + extra;
}

// Seen by the model: how the summary starts
export const SUMMARY_PREFIX = `[Summary of the earlier part of this conversation. You wrote it when the conversation got
too long. The earlier messages, tool calls and tool outputs were removed and are no longer
available, so treat this summary as the record of what happened. Files may have changed
since, so read a file again with read_file before relying on its exact content. Files you
changed earlier can still be undone with undo_changes. The conversation continues after
the summary.]`;

export function summaryItem(summary: string): HistoryItem {
  return { role: "user", content: `${SUMMARY_PREFIX}\n\n${summary.trim()}` };
}

// Seen by the model in place of a removed old output
export function removedOutputNote(tool: string, tokens: number, savedAt: string | null): string {
  const size = `about ${tokens.toLocaleString("en-US")} tokens`;
  const where = savedAt
    ? `The full output is saved at ${savedAt}. If you need any of it again, search it with grep or read the part you need with read_file instead of running the tool again.`
    : "It was not saved, so run the tool again if you need it.";
  return `[Output removed to save space: this ${tool} result (${size}) was older and no longer needed in full. ${where}]`;
}

export function isRemovedNote(output: string): boolean {
  return output.startsWith("[Output removed to save space:");
}

// Text of the assistant's reply in a model output
export function replyText(output: readonly HistoryItem[]): string {
  const parts: string[] = [];
  for (const item of output) {
    const fields = item as { type?: string; role?: string; content?: unknown };
    if (fields.role !== "assistant") continue;
    if (typeof fields.content === "string") parts.push(fields.content);
    else if (Array.isArray(fields.content)) {
      for (const part of fields.content as { text?: unknown }[]) {
        if (typeof part.text === "string") parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

export interface PruneTarget {
  index: number;
  callId: string;
  tool: string;
  output: string;
  tokens: number;
}

// Old, big tool outputs that can be replaced by a note
export function pruneTargets(items: readonly HistoryItem[]): PruneTarget[] {
  const names = new Map<string, string>();
  const outputs: PruneTarget[] = [];
  items.forEach((item, index) => {
    const fields = item as { type?: string; call_id?: string; name?: string; output?: unknown };
    if (fields.type === "function_call" && fields.call_id && fields.name) {
      names.set(fields.call_id, fields.name);
    }
    if (
      fields.type === "function_call_output" &&
      fields.call_id &&
      typeof fields.output === "string"
    ) {
      outputs.push({
        index,
        callId: fields.call_id,
        tool: names.get(fields.call_id) ?? "tool",
        output: fields.output,
        tokens: estimateTokens(fields.output.length),
      });
    }
  });
  return outputs
    .slice(0, Math.max(0, outputs.length - KEEP_RECENT_OUTPUTS))
    .filter((target) => target.tokens >= PRUNE_MIN_TOKENS && !isRemovedNote(target.output));
}
