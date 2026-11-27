import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import type { SlashCommand } from "./commands.js";
import { theme } from "./theme.js";

export interface RetryInfo {
  until: number;
  attempt: number;
  maxRetries: number;
  reason: string;
}

export function WorkingLine({ since, retry }: { since: number; retry?: RetryInfo | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), retry ? 250 : 1000);
    return () => clearInterval(timer);
  }, [retry]);
  if (retry) {
    const left = Math.max(0, Math.ceil((retry.until - now) / 1000));
    const when = left > 0 ? `retrying in ${left}s` : "retrying now";
    return (
      <Box marginTop={1}>
        <Text color={theme.warning}>
          <Spinner type="dots" /> {retry.reason}, {when}
        </Text>
        <Text color={theme.muted}>
          {" "}
          (attempt {retry.attempt} of {retry.maxRetries} · esc to stop)
        </Text>
      </Box>
    );
  }
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
  hint: string;
}

// Session tokens live in /usage; they add up the whole context on every call
export function StatusBar({ model, hint }: Props) {
  return (
    <Box paddingX={2} justifyContent="space-between">
      <Text color={theme.muted}>{hint}</Text>
      <Text color={theme.muted}>{model}</Text>
    </Box>
  );
}
