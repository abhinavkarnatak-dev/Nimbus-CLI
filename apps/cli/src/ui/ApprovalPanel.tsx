import { Box, Text } from "ink";
import type { ApprovalPrompt } from "../permissions.js";
import { shortenPath } from "./format.js";
import { theme } from "./theme.js";

export interface ApprovalState {
  prompt: ApprovalPrompt;
  selected: number;
}

// Most lines the box shows; the rest is printed above it
export const PREVIEW_LINES = 10;

// Box height that leaves room for the input and status bar
export function boxLines(rows: number): number {
  return Math.max(3, Math.min(PREVIEW_LINES, rows - 16));
}

export function approvalOptions(
  prompt: ApprovalPrompt,
): { label: string; choice: "yes" | "always" | "no" }[] {
  return [
    { label: "Yes", choice: "yes" },
    ...(prompt.remember
      ? [
          {
            label: `Yes, and don't ask again for ${prompt.remember} this session`,
            choice: "always" as const,
          },
        ]
      : []),
    { label: "No (esc)", choice: "no" },
  ];
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const lines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");

function clipLines(all: string[], max: number): { shown: string[]; more: number } {
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

const moreText = (more: number) => `… ${more} more lines, shown in full above`;

// An edit splits the box between old and new lines
const editLines = (max: number) => Math.max(2, Math.floor(max / 2));

// All of a long edit or file, for the scrollback above the box
export function fullPreview(prompt: ApprovalPrompt, max = PREVIEW_LINES): string | null {
  const { tool, args } = prompt.request;
  if (tool === "edit") {
    const removed = lines(str(args.old_string));
    const added = lines(str(args.new_string));
    const limit = editLines(max);
    if (removed.length <= limit && added.length <= limit) return null;
    return [
      `Full change to ${str(args.path)} (only made if you say yes):`,
      ...removed.map((line) => `- ${line}`),
      ...added.map((line) => `+ ${line}`),
    ].join("\n");
  }
  if (tool === "write_file") {
    const all = lines(str(args.content));
    if (all.length <= max) return null;
    return [`Full content of ${str(args.path)} (only written if you say yes):`, "", ...all].join(
      "\n",
    );
  }
  return null;
}

// Title and the part of the action worth reading first
function describe(prompt: ApprovalPrompt, max: number) {
  const { tool, args, folder } = prompt.request;
  if (folder) {
    const title =
      tool === "grep"
        ? "Search outside this folder"
        : tool === "glob"
          ? "List files outside this folder"
          : "Read a file outside this folder";
    const what =
      tool === "read_file"
        ? shortenPath(str(args.path))
        : `"${str(args.pattern)}" in ${shortenPath(str(args.path))}`;
    return {
      title,
      body: (
        <>
          <Text>{what}</Text>
          <Text
            color={theme.muted}
          >{`Only reads; nothing is changed. Folder: ${shortenPath(folder)}`}</Text>
        </>
      ),
    };
  }
  if (tool === "edit") {
    const removed = clipLines(lines(str(args.old_string)), editLines(max));
    const added = clipLines(lines(str(args.new_string)), editLines(max));
    return {
      title: `Edit ${str(args.path)}`,
      body: (
        <>
          {removed.shown.map((line, i) => (
            <Text key={`r${i}`} backgroundColor={theme.removedBg} color="white">
              {`- ${line}`}
            </Text>
          ))}
          {removed.more > 0 && <Text color={theme.muted}>{`  ${moreText(removed.more)}`}</Text>}
          {added.shown.map((line, i) => (
            <Text key={`a${i}`} backgroundColor={theme.addedBg} color="white">
              {`+ ${line}`}
            </Text>
          ))}
          {added.more > 0 && <Text color={theme.muted}>{`  ${moreText(added.more)}`}</Text>}
        </>
      ),
    };
  }
  if (tool === "write_file") {
    const all = lines(str(args.content));
    const { shown, more } = clipLines(all, max);
    return {
      title: `Write ${str(args.path)} (${all.length} line${all.length === 1 ? "" : "s"})`,
      body: (
        <>
          {shown.map((line, i) => (
            <Text key={i} color={theme.muted}>
              {line}
            </Text>
          ))}
          {more > 0 && <Text color={theme.muted}>{moreText(more)}</Text>}
        </>
      ),
    };
  }
  if (tool === "undo_changes") {
    const paths = Array.isArray(args.paths) ? args.paths.join(", ") : "every changed file";
    const replies = typeof args.replies === "number" ? args.replies : 1;
    return {
      title: "Undo file changes",
      body: (
        <Text color={theme.muted}>
          {`${replies === 1 ? "Last reply" : `Last ${replies} replies`}: ${paths}`}
        </Text>
      ),
    };
  }
  return {
    title: args.background ? "Run a command in the background" : "Run a command",
    body: <Text>{str(args.command)}</Text>,
  };
}

// Asks before an edit or a command
export function ApprovalPanel({
  state,
  maxLines = PREVIEW_LINES,
}: {
  state: ApprovalState | null;
  // Fewer lines on short terminals, so the box always fits
  maxLines?: number;
}) {
  if (!state) return null;
  const { title, body } = describe(state.prompt, maxLines);
  const options = approvalOptions(state.prompt);
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.accent}>◆ </Text>
        <Text bold>{title}</Text>
      </Text>
      <Box flexDirection="column" paddingLeft={2} marginY={1}>
        {body}
      </Box>
      {state.prompt.warning && <Text color={theme.warning}>{`⚠ ${state.prompt.warning}`}</Text>}
      {options.map((option, index) => {
        const active = index === state.selected;
        return (
          <Text key={option.choice} color={active ? theme.accent : "white"} bold={active}>
            {`${active ? "› " : "  "}${index + 1}. ${option.label}`}
          </Text>
        );
      })}
    </Box>
  );
}
