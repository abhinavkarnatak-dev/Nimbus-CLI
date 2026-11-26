import { describe, expect, it } from "vitest";
import {
  backspace,
  cursorPosition,
  deleteWordBack,
  fromText,
  insert,
  lineEnd,
  lineStart,
  moveBy,
  moveLine,
} from "../src/ui/editor.js";

describe("editor", () => {
  it("inserts at the cursor and normalizes pasted line endings", () => {
    const draft = insert({ value: "ac", cursor: 1 }, "b\r\nx");
    expect(draft).toEqual({ value: "ab\nxc", cursor: 4 });
  });

  it("deletes the character before the cursor", () => {
    expect(backspace({ value: "abc", cursor: 2 })).toEqual({ value: "ac", cursor: 1 });
    expect(backspace({ value: "abc", cursor: 0 })).toEqual({ value: "abc", cursor: 0 });
  });

  it("deletes the previous word", () => {
    expect(deleteWordBack(fromText("fix the bug "))).toEqual({ value: "fix the ", cursor: 8 });
  });

  it("keeps the cursor inside the text", () => {
    expect(moveBy(fromText("ab"), 5).cursor).toBe(2);
    expect(moveBy(fromText("ab"), -5).cursor).toBe(0);
  });

  it("moves to the start and end of the current line", () => {
    const draft = { value: "one\ntwo\nthree", cursor: 5 };
    expect(lineStart(draft).cursor).toBe(4);
    expect(lineEnd(draft).cursor).toBe(7);
  });

  it("moves between lines and keeps the column when it can", () => {
    const draft = { value: "hello\nhi\nworld", cursor: 4 };
    const down = moveLine(draft, 1)!;
    expect(cursorPosition(down)).toEqual({ line: 1, column: 2 });
    const downAgain = moveLine(down, 1)!;
    expect(cursorPosition(downAgain)).toEqual({ line: 2, column: 2 });
    expect(moveLine(downAgain, 1)).toBeNull();
    expect(moveLine(draft, -1)).toBeNull();
  });
});
