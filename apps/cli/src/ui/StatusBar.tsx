import type { Usage } from "@nimbus/harness";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import type { SlashCommand } from "./commands.js";
import { formatCost, formatTokens } from "./format.js";
import { theme } from "./theme.js";

export function WorkingLine({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - since) / 1000);
  return (
    <Box marginTop={1}>
      <Text color={theme.accent}>
        <Spinner type="dots" /> Working…
      </Text>
      <Text color={theme.muted}> ({seconds}s · esc to stop)</Text>
    </Box>
  );
}

export function CommandMenu({
  commands,
  selected,
}: {
  commands: SlashCommand[];
  selected: number;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {commands.map((command, index) => {
        const active = index === selected;
        return (
          <Text key={command.name}>
            <Text color={theme.accent}>{active ? "› " : "  "}</Text>
            <Text color={active ? theme.accent : "white"} bold={active}>
              {command.name.padEnd(10)}
            </Text>
            <Text color={active ? "white" : theme.muted}>{command.description}</Text>
          </Text>
        );
      })}
      <Text color={theme.muted}>{"  ↑↓ to select · enter to run · tab to complete"}</Text>
    </Box>
  );
}

interface Props {
  model: string;
  usage: Usage;
  cost: number;
  hint: string;
}

export function StatusBar({ model, usage, cost, hint }: Props) {
  const tokens = usage.inputTokens + usage.outputTokens;
  const cached =
    usage.inputTokens > 0 ? Math.round((usage.cachedTokens / usage.inputTokens) * 100) : 0;
  return (
    <Box paddingX={2} justifyContent="space-between">
      <Text color={theme.muted}>{hint}</Text>
      <Text color={theme.muted}>
        {model}
        {tokens > 0 &&
          ` · ${formatTokens(tokens)} tokens (${cached}% cached) · ${formatCost(cost)}`}
      </Text>
    </Box>
  );
}
