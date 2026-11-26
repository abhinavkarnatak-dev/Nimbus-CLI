import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { theme } from "./theme.js";

export interface UseOption {
  route: "nimbus" | "key";
  label: string;
  detail: string;
  current: boolean;
}

export type BillingPanelState =
  | { kind: "none" }
  | { kind: "key"; current: string | null; checking: boolean; error: string | null }
  | { kind: "use"; options: UseOption[]; selected: number };

// Key entry and the /use menu
export function BillingPanel({ panel }: { panel: BillingPanelState }) {
  if (panel.kind === "none") return null;
  if (panel.kind === "key") {
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
          {panel.current
            ? `Current key: ${panel.current}. Paste a new key to replace it.`
            : "Paste your OpenAI API key. It stays on this computer."}
        </Text>
        {panel.checking ? (
          <Text color={theme.muted}>
            <Text color={theme.accent}>
              <Spinner type="dots" />
            </Text>{" "}
            Checking the key with OpenAI...
          </Text>
        ) : (
          <Text color={panel.error ? theme.error : theme.muted}>
            {panel.error ?? "Enter to save · esc to cancel"}
          </Text>
        )}
      </Box>
    );
  }
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.accent}>◆ </Text>Pay for model calls with
      </Text>
      {panel.options.map((option, index) => {
        const active = index === panel.selected;
        return (
          <Text key={option.route}>
            <Text color={theme.accent}>{active ? "› " : "  "}</Text>
            <Text color={active ? theme.accent : "white"} bold={active}>
              {option.label.padEnd(18)}
            </Text>
            <Text color={theme.muted}>
              {option.detail}
              {option.current ? "  (current)" : ""}
            </Text>
          </Text>
        );
      })}
      <Text color={theme.muted}>↑↓ to select · enter to switch · esc to close</Text>
    </Box>
  );
}
