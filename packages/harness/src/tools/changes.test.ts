import { describe, expect, it } from "vitest";
import { mergeLines } from "./changes.js";

const lines = (text: string) => text.split(" ");

describe("mergeLines", () => {
  it("undoes our change and keeps the user's elsewhere", () => {
    // base is how Nimbus left it, undo is the file before, user is the file now
    expect(mergeLines(lines("a B c d e"), lines("a b c d e"), lines("a B c d E"))).toEqual(
      lines("a b c d E"),
    );
  });

  it("allows changes on lines right next to each other", () => {
    expect(mergeLines(lines("a B c"), lines("a b c"), lines("a B C"))).toEqual(lines("a b C"));
  });

  it("removes a line Nimbus added and keeps a line the user added", () => {
    expect(mergeLines(lines("a x b"), lines("a b"), lines("a x b y"))).toEqual(lines("a b y"));
  });

  it("refuses when both changed the same line", () => {
    expect(mergeLines(lines("a B c"), lines("a b c"), lines("a Z c"))).toBeNull();
  });

  it("refuses when both added lines at the same spot", () => {
    expect(mergeLines(lines("a b"), lines("a x b"), lines("a y b"))).toBeNull();
  });
});
