// Text and cursor state for the prompt
export interface Draft {
  value: string;
  cursor: number;
}

export const emptyDraft: Draft = { value: "", cursor: 0 };

export function insert(draft: Draft, text: string): Draft {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  return {
    value: draft.value.slice(0, draft.cursor) + clean + draft.value.slice(draft.cursor),
    cursor: draft.cursor + clean.length,
  };
}

export function backspace(draft: Draft): Draft {
  if (draft.cursor === 0) return draft;
  return {
    value: draft.value.slice(0, draft.cursor - 1) + draft.value.slice(draft.cursor),
    cursor: draft.cursor - 1,
  };
}

export function deleteWordBack(draft: Draft): Draft {
  const before = draft.value.slice(0, draft.cursor);
  const kept = before.replace(/\S+\s*$|\s+$/, "");
  return { value: kept + draft.value.slice(draft.cursor), cursor: kept.length };
}

export function moveBy(draft: Draft, delta: number): Draft {
  const cursor = Math.min(Math.max(draft.cursor + delta, 0), draft.value.length);
  return { ...draft, cursor };
}

export function lineStart(draft: Draft): Draft {
  return { ...draft, cursor: draft.value.lastIndexOf("\n", draft.cursor - 1) + 1 };
}

export function lineEnd(draft: Draft): Draft {
  const end = draft.value.indexOf("\n", draft.cursor);
  return { ...draft, cursor: end === -1 ? draft.value.length : end };
}

// Line and column of the cursor
export function cursorPosition(draft: Draft): { line: number; column: number } {
  const before = draft.value.slice(0, draft.cursor).split("\n");
  return { line: before.length - 1, column: before.at(-1)?.length ?? 0 };
}

// Move up or down a line, or null at the edge
export function moveLine(draft: Draft, direction: -1 | 1): Draft | null {
  const lines = draft.value.split("\n");
  const { line, column } = cursorPosition(draft);
  const target = line + direction;
  if (target < 0 || target >= lines.length) return null;
  let cursor = 0;
  for (let i = 0; i < target; i++) cursor += (lines[i]?.length ?? 0) + 1;
  cursor += Math.min(column, lines[target]?.length ?? 0);
  return { ...draft, cursor };
}

export function fromText(value: string): Draft {
  return { value, cursor: value.length };
}
