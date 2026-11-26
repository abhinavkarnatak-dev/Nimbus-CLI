import chalk from "chalk";
import { Box, Text, useInput, usePaste } from "ink";
import { useRef } from "react";
import type { SlashCommand } from "./commands.js";
import {
  backspace,
  cursorPosition,
  deleteWordBack,
  emptyDraft,
  fromText,
  insert,
  lineEnd,
  lineStart,
  moveBy,
  moveLine,
  type Draft,
} from "./editor.js";
import { theme } from "./theme.js";

interface Props {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSubmit: (text: string) => void;
  history: string[];
  placeholder: string;
  menu: SlashCommand[];
  selected: number;
  onSelect: (index: number) => void;
  // True while Up/Down is walking through history
  onBrowsingChange: (browsing: boolean) => void;
}

// Draw the text with an inverse cursor
function renderLines(draft: Draft): string[] {
  const { line: cursorLine, column } = cursorPosition(draft);
  return draft.value.split("\n").map((line, index) => {
    if (index !== cursorLine) return line;
    const char = line[column] ?? " ";
    return line.slice(0, column) + chalk.inverse(char) + line.slice(column + 1);
  });
}

export function PromptInput({
  draft,
  onChange,
  onSubmit,
  history,
  placeholder,
  menu,
  selected,
  onSelect,
  onBrowsingChange,
}: Props) {
  // Index into history while browsing, saved draft to restore
  const browsing = useRef<{ index: number; saved: Draft } | null>(null);
  const setBrowsing = (value: { index: number; saved: Draft } | null) => {
    if ((browsing.current === null) !== (value === null)) onBrowsingChange(value !== null);
    browsing.current = value;
  };

  // Latest draft, so fast keys never use a stale value
  const latest = useRef(draft);
  latest.current = draft;
  const apply = (next: Draft) => {
    latest.current = next;
    onChange(next);
  };

  usePaste((text) => {
    setBrowsing(null);
    apply(insert(latest.current, text));
  });

  useInput((input, key) => {
    if (key.ctrl && input === "c") return;
    if (key.escape) return;

    // Command menu takes the arrows, Tab and Enter
    if (menu.length > 0) {
      const choice = menu[selected] ?? menu[0]!;
      if (key.upArrow || key.downArrow) {
        const step = key.upArrow ? -1 : 1;
        onSelect((selected + step + menu.length) % menu.length);
        return;
      }
      if (key.tab) {
        apply(fromText(choice.name));
        return;
      }
      if (key.return && !key.meta && !key.shift) {
        setBrowsing(null);
        onSubmit(choice.name);
        return;
      }
    }

    if (key.return) {
      if (key.meta || key.shift) {
        apply(insert(latest.current, "\n"));
        return;
      }
      if (latest.current.value.slice(0, latest.current.cursor).endsWith("\\")) {
        apply(insert(backspace(latest.current), "\n"));
        return;
      }
      const text = latest.current.value.trim();
      if (!text) return;
      setBrowsing(null);
      onSubmit(text);
      return;
    }

    if (key.tab) return;

    if (key.upArrow || key.downArrow) {
      const direction = key.upArrow ? -1 : 1;
      const moved = moveLine(latest.current, direction);
      if (moved) {
        apply(moved);
        return;
      }
      if (history.length === 0) return;
      const current = browsing.current;
      const index = (current?.index ?? history.length) + direction;
      if (index < 0) return;
      if (index >= history.length) {
        if (current) apply(current.saved);
        setBrowsing(null);
        return;
      }
      setBrowsing({ index, saved: current?.saved ?? latest.current });
      apply(fromText(history[index]!));
      return;
    }

    if (key.backspace || key.delete) {
      setBrowsing(null);
      apply(key.ctrl || key.meta ? deleteWordBack(latest.current) : backspace(latest.current));
      return;
    }
    if (key.leftArrow) return void apply(moveBy(latest.current, -1));
    if (key.rightArrow) return void apply(moveBy(latest.current, 1));
    if (key.home || (key.ctrl && input === "a")) return void apply(lineStart(latest.current));
    if (key.end || (key.ctrl && input === "e")) return void apply(lineEnd(latest.current));
    if (key.ctrl && (input === "u" || input === "w")) {
      setBrowsing(null);
      return void apply(input === "u" ? emptyDraft : deleteWordBack(latest.current));
    }
    if (key.ctrl || key.meta || !input) return;

    setBrowsing(null);
    apply(insert(latest.current, input));
  });

  const lines = draft.value ? renderLines(draft) : null;

  return (
    <Box borderStyle="round" borderColor={theme.accentDim} paddingX={1}>
      <Text color={theme.accent}>{"> "}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {lines ? (
          lines.map((line, index) => <Text key={index}>{line}</Text>)
        ) : (
          <Text>
            {chalk.inverse(placeholder[0] ?? " ")}
            <Text color={theme.muted}>{placeholder.slice(1)}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}
