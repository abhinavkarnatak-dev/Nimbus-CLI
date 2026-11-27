import { Box, Text } from "ink";
import { useAnimate, useWidth } from "./width.js";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { describeResult, formatDuration, parseDiff, toolLabel } from "./format.js";
import { theme } from "./theme.js";
import type { Item } from "./transcript.js";

type ToolItem = Extract<Item, { kind: "tool" }>;

const MAX_DIFF_LINES = 24;

function Elapsed({ since }: { since: number }) {
  const animate = useAnimate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [animate]);
  const seconds = Math.floor((now - since) / 1000);
  return seconds >= 2 ? <Text color={theme.muted}> {seconds}s</Text> : null;
}

function DiffView({ diff, width }: { diff: string; width: number }) {
  const lines = parseDiff(diff);
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const numberWidth = String(Math.max(0, ...shown.map((line) => line.number))).length;
  return (
    <Box flexDirection="column">
      {shown.map((line, index) => {
        const sign = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
        const body = `${String(line.number).padStart(numberWidth)} ${sign} ${line.text}`;
        const padded = body.length < width ? body.padEnd(width) : body.slice(0, width);
        if (line.kind === "context") {
          return (
            <Text key={index} color={theme.muted}>
              {body.slice(0, width)}
            </Text>
          );
        }
        return (
          <Text
            key={index}
            backgroundColor={line.kind === "add" ? theme.addedBg : theme.removedBg}
            color="white"
          >
            {padded}
          </Text>
        );
      })}
      {lines.length > shown.length && (
        <Text color={theme.muted}>… {lines.length - shown.length} more lines</Text>
      )}
    </Box>
  );
}

// Bash shows its output, other tools a sentence
function resultLines(item: ToolItem): { headline: string; extra?: string } {
  const failed = item.status === "error";
  const sentence = describeResult(item.name, item.summary ?? "", failed);
  const isCommand = item.name === "bash" || item.name === "bash_output";
  if (isCommand && !failed && /^Exit code/.test(sentence)) {
    if (!item.preview) return { headline: "(No output)" };
    const [first = "", ...rest] = item.preview.split("\n");
    return { headline: first, extra: rest.join("\n") || undefined };
  }
  return { headline: sentence, extra: item.preview };
}

export function ToolRow({ item }: { item: ToolItem }) {
  const columns = useWidth();
  const animate = useAnimate();
  const { verb, target } = toolLabel(item.name, item.args);
  const running = item.status === "running";
  const failed = item.status === "error";
  const { headline, extra } = running ? { headline: "" } : resultLines(item);
  const slow = item.durationMs !== undefined && item.durationMs >= 1000;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate-end">
        {running ? (
          <Text color={theme.accent}>{animate ? <Spinner type="dots" /> : "◆"}</Text>
        ) : (
          <Text color={failed ? theme.error : theme.success}>●</Text>
        )}
        <Text bold> {verb}</Text>
        {target && <Text color={theme.muted}>({target})</Text>}
        {running && <Elapsed since={item.startedAt} />}
      </Text>
      {!running && (
        <Box paddingLeft={2}>
          <Box width={3} flexShrink={0}>
            <Text color={theme.muted}>⎿</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text color={failed ? theme.error : undefined} wrap="truncate-end">
              {headline}
              {slow && <Text color={theme.muted}> · {formatDuration(item.durationMs!)}</Text>}
            </Text>
            {extra && (
              <Text color={theme.muted} wrap="truncate-end">
                {extra}
              </Text>
            )}
            {item.diff && !failed && (
              <DiffView diff={item.diff} width={Math.max(columns - 7, 20)} />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
