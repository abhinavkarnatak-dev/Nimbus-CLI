import { Box, Text } from "ink";
import type { SessionSummary } from "../store/sqlite.js";
import { timeAgo } from "./resume.js";
import { shownTitle } from "./shown.js";
import { theme } from "./theme.js";

export interface ResumePicker {
  options: SessionSummary[];
  selected: number;
}

const VISIBLE = 8;

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// List of earlier conversations in this folder
export function ResumePanel({ picker }: { picker: ResumePicker | null }) {
  if (!picker) return null;
  const start = Math.max(
    0,
    Math.min(picker.selected - Math.floor(VISIBLE / 2), picker.options.length - VISIBLE),
  );
  const shown = picker.options.slice(start, start + VISIBLE);
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.accent}>◆ </Text>Resume a conversation
      </Text>
      {shown.map((option, i) => {
        const active = start + i === picker.selected;
        const messages = `${option.turns} message${option.turns === 1 ? "" : "s"}`;
        return (
          <Text key={option.id} wrap="truncate-end">
            <Text color={theme.accent}>{active ? "› " : "  "}</Text>
            <Text color={active ? theme.accent : "white"} bold={active}>
              {clip(shownTitle(option.title), 56).padEnd(56)}
            </Text>
            <Text color={theme.muted}>
              {"  "}
              {timeAgo(option.updatedAt)} · {messages}
            </Text>
          </Text>
        );
      })}
      <Text color={theme.muted}>↑↓ to select · enter to open · esc to close</Text>
    </Box>
  );
}
