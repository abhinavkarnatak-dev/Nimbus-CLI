import { Box, Text } from "ink";
import { MODES } from "../permissions.js";
import type { PermissionMode } from "../settings.js";
import { theme } from "./theme.js";

export interface ModePicker {
  selected: number;
  current: PermissionMode;
}

// /permissions: pick how much Nimbus asks
export function PermissionsPanel({ picker }: { picker: ModePicker | null }) {
  if (!picker) return null;
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.accent}>◆ </Text>When should Nimbus ask before acting?
      </Text>
      {MODES.map((option, index) => {
        const active = index === picker.selected;
        return (
          <Text key={option.mode} color={active ? theme.accent : "white"} bold={active}>
            {`${active ? "› " : "  "}${option.label}`}
            {option.mode === picker.current && <Text color={theme.muted}> (current)</Text>}
          </Text>
        );
      })}
      <Text color={theme.muted}>↑↓ to select · enter to choose · esc to cancel</Text>
    </Box>
  );
}
