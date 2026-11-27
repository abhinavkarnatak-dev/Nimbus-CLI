import type { Todo } from "@nimbus/harness";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

const MARKS = { pending: "☐", in_progress: "◐", done: "☑" } as const;

// The model's checklist, live while it works
export function TodoPanel({ todos }: { todos: readonly Todo[] }) {
  if (todos.length === 0 || todos.every((todo) => todo.status === "done")) return null;
  return (
    <Box marginTop={1} paddingLeft={2} flexDirection="column">
      {todos.map((todo, index) => (
        <Text
          key={index}
          color={
            todo.status === "in_progress"
              ? theme.accent
              : todo.status === "done"
                ? theme.muted
                : "white"
          }
          strikethrough={todo.status === "done"}
        >
          {MARKS[todo.status]} {todo.text}
        </Text>
      ))}
    </Box>
  );
}
