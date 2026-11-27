import type { ContextUsage } from "@nimbus/harness";
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

export function WorkingLine({
  since,
  retry,
  label = "Working…",
}: {
  since: number;
  retry?: RetryInfo | null;
  label?: string;
}) {
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
        <Spinner type="dots" /> {label}
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
  context?: ContextUsage;
}

// Gray while there is room, then yellow and red
export function contextColor(percent: number): string {
  if (percent >= 80) return theme.error;
  if (percent >= 60) return theme.warning;
  return theme.muted;
}

export function contextPercent(context: ContextUsage): number {
  const percent = Math.round((context.tokens / context.limit) * 100);
  return context.tokens > 0 ? Math.max(percent, 1) : 0;
}

export function StatusBar({ model, hint, context }: Props) {
  const percent = context ? contextPercent(context) : null;
  return (
    <Box paddingX={2} justifyContent="space-between">
      <Text color={theme.muted}>{hint}</Text>
      <Text color={theme.muted}>
        {model}
        {percent !== null && (
          <>
            {" · "}
            <Text color={contextColor(percent)}>context {percent}%</Text>
          </>
        )}
      </Text>
    </Box>
  );
}
