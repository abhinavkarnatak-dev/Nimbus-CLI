import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ChangeLog, MAX_SNAPSHOT_BYTES } from "./changes.js";
import { editTool } from "./edit.js";
import { FileTracker } from "./file-state.js";
import { readFileTool } from "./read-file.js";
import { undoTool } from "./undo.js";
import { writeFileTool } from "./write-file.js";

let root: string;
let files: FileTracker;
let changes: ChangeLog;
const ctx = () => ({ cwd: root, signal: new AbortController().signal, files, changes });
const read = (path: string) =>
  readFileTool.execute(JSON.stringify({ path, offset: null, limit: null }), ctx());
const edit = (path: string, old_string: string, new_string: string) =>
  editTool.execute(JSON.stringify({ path, old_string, new_string, replace_all: null }), ctx());
const write = (path: string, content: string) =>
  writeFileTool.execute(JSON.stringify({ path, content }), ctx());
const undo = (args: Record<string, unknown> = {}) =>
  undoTool.execute(
    JSON.stringify({
      replies: null,
      paths: null,
      restore_to: null,
      overwrite_user_edits: null,
      ...args,
    }),
    ctx(),
  );
const contents = (path: string) => readFile(join(root, path), "utf8");
const exists = (path: string) =>
  stat(join(root, path)).then(
    () => true,
    () => false,
  );

const PAGE =
  "<h1>Shop</h1>\n<p>One</p>\n<p>Two</p>\n<p>Three</p>\n<p>Four</p>\n<p>Five</p>\n<footer>Hi</footer>\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-undo-"));
  files = new FileTracker();
  changes = new ChangeLog();
  await writeFile(join(root, "page.html"), PAGE);
});

// Reply 1: Nimbus changes the heading and adds a test file
async function firstReply() {
  changes.begin(1, "make the heading bigger");
  await read("page.html");
  await edit("page.html", "<h1>Shop</h1>", "<h1 class=big>Shop</h1>");
  await write("notes.md", "draft\n");
  changes.begin(2, "undo that");
}

describe("undo_changes", () => {
  it("restores edited files and deletes created ones", async () => {
    await firstReply();
    const result = await undo();
    expect(await contents("page.html")).toBe(PAGE);
    expect(await exists("notes.md")).toBe(false);
    expect(result.summary).toBe("restored 2");
    expect(result.output).toBe(
      [
        'Undid your changes from 1 reply ("make the heading bigger"):',
        "- notes.md: deleted, you had created it",
        "- page.html: restored",
        "Read these files again before changing them.",
        "If the user wants these changes back, call undo_changes again with replies 1.",
      ].join("\n"),
    );
  });

  it("keeps the user's edits on other lines", async () => {
    await firstReply();
    const edited = (await contents("page.html")).replace(
      "<footer>Hi</footer>",
      "<footer>Bye</footer>",
    );
    await writeFile(join(root, "page.html"), edited);
    const result = await undo({ paths: ["page.html"] });
    expect(await contents("page.html")).toBe(PAGE.replace("Hi", "Bye"));
    expect(result.output).toContain("page.html: restored, the user's later edits were kept");
    expect(await exists("notes.md")).toBe(true);
  });

  it("keeps the user's edit a few lines away from Nimbus's change", async () => {
    changes.begin(1, "add cutting chai");
    await read("page.html");
    await edit("page.html", "<p>Five</p>", "<p>Five</p>\n<p>Cutting</p>");
    changes.begin(2, "revert your last change");
    const edited = (await contents("page.html")).replace(
      "<footer>Hi</footer>",
      "<footer>Bye</footer>",
    );
    await writeFile(join(root, "page.html"), edited);
    const result = await undo();
    expect(await contents("page.html")).toBe(PAGE.replace("Hi", "Bye"));
    expect(result.output).toContain("page.html: restored, the user's later edits were kept");
  });

  it("skips same-line edits and overwrites only after the user answered", async () => {
    await firstReply();
    const mine = PAGE.replace("<h1>Shop</h1>", "<h1 class=huge>Shop!</h1>");
    await writeFile(join(root, "page.html"), mine);
    const skipped = await undo({ paths: ["page.html"] });
    expect(skipped.output).toContain(
      "page.html: skipped, the user edited the same lines you changed",
    );
    expect(skipped.output).toContain("Ask the user whether to drop their edits");
    expect(skipped.output).not.toContain("Read these files again");
    expect(skipped.summary).toBe("restored 0, skipped 1");

    // Same reply: the model did not wait for an answer
    const tooSoon = await undo({ paths: ["page.html"], overwrite_user_edits: true });
    expect(tooSoon.summary).toBe("restored 0, skipped 1");
    expect(await contents("page.html")).toBe(mine);

    changes.begin(3, "yes, overwrite it");
    const forced = await undo({ paths: ["page.html"], overwrite_user_edits: true });
    expect(forced.output).toContain("page.html: restored, the user's edits there were dropped");
    expect(await contents("page.html")).toBe(PAGE);
  });

  it("with paths, finds the last reply that changed those files", async () => {
    await firstReply();
    await read("notes.md");
    await edit("notes.md", "draft", "final");
    changes.begin(3, "undo the page change");
    const result = await undo({ paths: ["page.html"] });
    expect(result.output).toContain('1 reply ("make the heading bigger")');
    expect(await contents("page.html")).toBe(PAGE);
    expect(await contents("notes.md")).toBe("final\n");
  });

  it("puts a file back exactly as Nimbus left it", async () => {
    await firstReply();
    const left = await contents("page.html");
    await writeFile(join(root, "page.html"), left + "<p>broken</p>\n");
    const result = await undo({ paths: ["page.html"], restore_to: "as_left" });
    expect(await contents("page.html")).toBe(left);
    expect(result.output).toContain("page.html: put back exactly as you left it");
  });

  it("goes back one reply by default and more when asked", async () => {
    await firstReply();
    await read("page.html");
    await edit("page.html", "<p>One</p>", "<p>1</p>");
    changes.begin(3, "undo");
    await undo();
    expect(await contents("page.html")).toBe(
      PAGE.replace("<h1>Shop</h1>", "<h1 class=big>Shop</h1>"),
    );
    changes.begin(4, "undo both");
    // Reply 3 was itself an undo, so three replies reach back to the start
    const result = await undo({ replies: 3 });
    expect(await contents("page.html")).toBe(PAGE);
    expect(result.output).toContain('3 replies ("undo", "undo that", "make the heading bigger")');
  });

  it("can undo an undo", async () => {
    await firstReply();
    const left = await contents("page.html");
    await undo();
    changes.begin(3, "bring it back");
    await undo();
    expect(await contents("page.html")).toBe(left);
    expect(await contents("notes.md")).toBe("draft\n");
  });

  it("says when the user deleted the file, or it was too big to copy", async () => {
    await firstReply();
    await write("big.txt", "x".repeat(MAX_SNAPSHOT_BYTES + 1));
    await rm(join(root, "page.html"));
    changes.begin(3, "undo");
    const big = await undo();
    expect(big.output).toContain("big.txt: skipped, too big to keep a copy (over 2MB)");
    changes.begin(4, "undo more");
    const gone = await undo({ replies: 2, paths: ["page.html"] });
    expect(gone.output).toContain("page.html: skipped, the user deleted it since");
  });

  it("mentions bash commands it could not undo", async () => {
    await firstReply();
    changes.noteCommand(1);
    const result = await undo();
    expect(result.output).toContain(
      "That reply also ran bash commands. Their changes were not undone.",
    );
  });

  it("says when there is nothing to undo", async () => {
    changes.begin(1, "hello");
    expect((await undo()).output).toBe("There are no file changes from earlier replies to undo.");
    await firstReply();
    expect((await undo({ paths: ["other.ts"] })).output).toBe(
      "None of those files were changed in earlier replies.",
    );
  });

  it("never undoes the reply it is running in", async () => {
    changes.begin(1, "edit and undo at once");
    await read("page.html");
    await edit("page.html", "<p>One</p>", "<p>1</p>");
    expect((await undo()).summary).toBe("nothing to undo");
    expect(await contents("page.html")).toContain("<p>1</p>");
  });
});
