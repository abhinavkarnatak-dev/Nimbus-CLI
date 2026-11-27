import { z } from "zod";
import { defineTool } from "./types.js";

export type TodoStatus = "pending" | "in_progress" | "done";

export interface Todo {
  text: string;
  status: TodoStatus;
}

const schema = z.strictObject({
  todos: z.array(
    z.strictObject({
      text: z.string().min(1),
      status: z.enum(["pending", "in_progress", "done"]),
    }),
  ),
});

const MARKS: Record<TodoStatus, string> = { pending: "☐", in_progress: "◐", done: "☑" };

// One line per item, for the screen
export function todoLines(todos: readonly Todo[]): string {
  return todos.map((todo) => `${MARKS[todo.status]} ${todo.text}`).join("\n");
}

// The latest list from update_todos calls in a history
export function todosFrom(items: readonly unknown[]): Todo[] {
  let latest: Todo[] = [];
  for (const item of items) {
    const call = item as { type?: string; name?: string; arguments?: string };
    if (call.type !== "function_call" || call.name !== "update_todos") continue;
    try {
      const parsed = schema.safeParse(JSON.parse(call.arguments ?? ""));
      if (parsed.success) latest = parsed.data.todos;
    } catch {
      // Bad arguments were refused when the call ran
    }
  }
  return latest;
}

export const todosTool = defineTool({
  name: "update_todos",
  description: `Keep a short checklist for the current task, shown live to the user. Use it for tasks
with 3 or more steps, or when the user lists several things to do. Skip it for quick
questions and one-step changes.
- todos: the whole list every time, in order. Each item has text (what to do, short)
  and status: "pending", "in_progress" or "done".
- Keep exactly one item "in_progress" while you work, and mark each item "done" as soon
  as it is finished, not all at the end.
- Change the list when the plan changes: add, remove or reword items.`,
  schema,
  // Save the list the user sees
  async run({ todos }) {
    const count = (status: TodoStatus) => todos.filter((todo) => todo.status === status).length;
    const done = count("done");
    return {
      output: `Todo list saved (${done} done, ${count("in_progress")} in progress, ${count("pending")} pending).`,
      summary: `${done} of ${todos.length} done`,
      preview: todoLines(todos),
    };
  },
});
