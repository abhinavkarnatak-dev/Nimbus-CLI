import { Box, Text } from "ink";
import { formatCost } from "./format.js";
import { theme } from "./theme.js";

export interface BudgetPause {
  budget: number;
  // How much Enter adds on top
  step: number;
}

// Asks before spending past the session budget
export function BudgetPanel({ pause }: { pause: BudgetPause | null }) {
  if (!pause) return null;
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.warning}
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.warning}>◆ </Text>
        This session reached its {formatCost(pause.budget)} budget.
      </Text>
      <Text color={theme.muted}>
        Press Enter to allow {formatCost(pause.step)} more, or Esc to stop.
      </Text>
    </Box>
  );
}
