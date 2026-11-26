import { Box, Text } from "ink";
import { Markdown } from "./Markdown.js";
import { theme } from "./theme.js";
import { ToolRow } from "./ToolRow.js";
import type { Item } from "./transcript.js";

export function ItemView({ item }: { item: Exclude<Item, { kind: "header" }> }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color={theme.muted}>› </Text>
          <Text color={theme.muted}>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Text color={theme.accent}>{item.continued ? "  " : "● "}</Text>
          <Box flexGrow={1}>
            <Markdown text={item.text} />
          </Box>
        </Box>
      );
    case "tool":
      return <ToolRow item={item} />;
    case "notice":
      return (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={item.tone === "error" ? theme.error : theme.muted}>
            {item.tone === "error" ? "✗ " : "⎿  "}
            {item.text}
          </Text>
        </Box>
      );
  }
}
