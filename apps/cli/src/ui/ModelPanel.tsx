import { EFFORT_HINTS, MODELS, modelInfo, type ReasoningEffort } from "@nimbus/harness";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

export type ModelPickerState =
  | { stage: "model"; selected: number; current: string; effort: ReasoningEffort }
  | { stage: "effort"; model: string; selected: number; current: ReasoningEffort };

// Levels the picked model accepts
export function effortsOf(model: string): readonly ReasoningEffort[] {
  return modelInfo(model)?.efforts ?? [];
}

// /model: pick a model, then how long it thinks
export function ModelPanel({ picker }: { picker: ModelPickerState | null }) {
  if (!picker) return null;
  const rows =
    picker.stage === "model"
      ? MODELS.map((model) => ({
          key: model.id,
          label: model.id,
          hint: model.older ? `${model.blurb} (older)` : model.blurb,
          current: model.id === picker.current,
        }))
      : effortsOf(picker.model).map((effort) => ({
          key: effort,
          label: effort,
          hint: effort === "medium" ? `${EFFORT_HINTS[effort]} (default)` : EFFORT_HINTS[effort],
          current: effort === picker.current,
        }));
  const width = Math.max(...rows.map((row) => row.label.length)) + 2;
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
        {picker.stage === "model" ? "Choose a model" : `How much should ${picker.model} think?`}
      </Text>
      {rows.map((row, index) => {
        const active = index === picker.selected;
        return (
          <Text key={row.key} color={active ? theme.accent : "white"} bold={active}>
            {`${active ? "› " : "  "}${row.label.padEnd(width)}`}
            <Text color={theme.muted} bold={false}>
              {row.hint}
              {row.current ? " · current" : ""}
            </Text>
          </Text>
        );
      })}
      <Text color={theme.muted}>↑↓ to select · enter to choose · esc to cancel</Text>
    </Box>
  );
}
