import { z } from "zod";
import type { UndoFileResult, UndoResult } from "./changes.js";
import { defineTool } from "./types.js";

const schema = z.strictObject({
  replies: z.number().int().min(1).max(20).nullable(),
  paths: z.array(z.string()).nullable(),
  restore_to: z.enum(["before", "as_left"]).nullable(),
  overwrite_user_edits: z.boolean().nullable(),
});

const LINES: Record<UndoFileResult["outcome"], string> = {
  restored: "restored",
  merged: "restored, the user's later edits were kept",
  deleted: "deleted, you had created it",
  as_left: "put back exactly as you left it",
  overwritten: "restored, the user's edits there were dropped",
  conflict: "skipped, the user edited the same lines you changed",
  gone: "skipped, the user deleted it since",
  too_big: "skipped, too big to keep a copy (over 2MB)",
};

const SKIPPED = new Set<UndoFileResult["outcome"]>(["conflict", "gone", "too_big"]);

// What the model reads back
export function describeUndo(result: UndoResult): string {
  const count = result.titles.length;
  const titles = result.titles.map((title) => `"${title}"`).join(", ");
  const lines = [
    `Undid your changes from ${count} ${count === 1 ? "reply" : "replies"} (${titles}):`,
  ];
  for (const file of result.files) lines.push(`- ${file.display}: ${LINES[file.outcome]}`);
  if (result.ranCommands) {
    lines.push(
      count === 1
        ? "That reply also ran bash commands. Their changes were not undone."
        : "Those replies also ran bash commands. Their changes were not undone.",
    );
  }
  if (result.files.some((file) => file.outcome === "conflict" || file.outcome === "gone")) {
    lines.push(
      "Ask the user whether to drop their edits in the skipped files and wait for their answer. Only then call again with overwrite_user_edits true.",
    );
  }
  if (result.files.some((file) => !SKIPPED.has(file.outcome))) {
    lines.push("Read these files again before changing them.");
    lines.push("If the user wants these changes back, call undo_changes again with replies 1.");
  }
  return lines.join("\n");
}

function summaryOf(result: UndoResult): string {
  const skipped = result.files.filter((file) => SKIPPED.has(file.outcome)).length;
  const done = result.files.length - skipped;
  return skipped ? `restored ${done}, skipped ${skipped}` : `restored ${done}`;
}

export const undoTool = defineTool({
  name: "undo_changes",
  description: `Undo file changes you made with edit and write_file in earlier replies.
Use it only when the user asks to undo, revert or bring back changes. Never use it on
your own to fix a mistake; fix that with edit instead.
- Changes made by bash commands cannot be undone with this tool.
- replies: how many of your most recent replies that changed files to undo, newest
  first. Use null for 1.
- paths: undo only these files. Use null for every file those replies changed.
- restore_to: "before" undoes only the lines you changed and keeps edits the user made
  since. "as_left" puts files back exactly as you left them and drops the user's later
  edits; use it only when the user wants their own edits gone. Use null for "before".
- overwrite_user_edits: if the user edited the same lines you changed, that file is
  skipped. Ask the user, and only if they agree to lose their edits there, call again
  with true. Use null for false.
The undo itself can be undone: call this tool again with replies 1.`,
  schema,
  // Put files back from saved copies
  async run({ replies, paths, restore_to, overwrite_user_edits }, ctx) {
    if (!ctx.changes) throw new Error("undo is not available in this session");
    const result = await ctx.changes.undo(
      {
        replies: replies ?? 1,
        paths,
        restoreTo: restore_to ?? "before",
        overwriteUserEdits: overwrite_user_edits ?? false,
      },
      ctx.cwd,
    );
    if (result.titles.length === 0) {
      const output = paths
        ? "None of those files were changed in earlier replies."
        : "There are no file changes from earlier replies to undo.";
      return { output, summary: "nothing to undo" };
    }
    const preview = result.files
      .map((file) => `${file.display}: ${LINES[file.outcome]}`)
      .join("\n");
    return { output: describeUndo(result), summary: summaryOf(result), preview };
  },
});
