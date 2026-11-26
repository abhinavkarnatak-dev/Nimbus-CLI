// A real Nimbus session in the CLI Test folder, recorded 27 Nov 2026

export type Line = { kind: "add" | "del" | "ctx" | "out"; n?: number; text: string };

export interface ToolRow {
  kind: "tool";
  tool: string;
  arg: string;
  result: string;
  lines?: Line[];
}

export interface ReplyRow {
  kind: "reply";
  paragraphs: string[];
}

export type Row = ToolRow | ReplyRow;

export const PROMPT =
  'Add a slugify function in src/slug.js that turns text like "Hello World!" into "hello-world", with tests in test/slug.test.js covering spaces, punctuation and accented letters. Run the tests and fix anything that fails. Then check the Node docs online for the right flag to run tests in watch mode, and add a test:watch script to package.json.';

const add = (n: number, text: string): Line => ({ kind: "add", n, text });

export const ROWS: Row[] = [
  {
    kind: "tool",
    tool: "Glob",
    arg: "**/{package.json,src/**,test/**}",
    result: "Found 5 files",
  },
  { kind: "tool", tool: "Grep", arg: '"node:test|slugify|"scripts""', result: "Found 2 matches" },
  { kind: "tool", tool: "Read", arg: "package.json", result: "Read 10 lines" },
  { kind: "tool", tool: "Read", arg: "test/math.test.js", result: "Read 15 lines" },
  { kind: "tool", tool: "Read", arg: "src/index.js", result: "Read 7 lines" },
  { kind: "tool", tool: "Read", arg: "src/greet.js", result: "Read 7 lines" },
  {
    kind: "tool",
    tool: "Search",
    arg: '"site:nodejs.org/api/test.html node test runner watch flag"',
    result: "Found 3 results · 2.5s",
  },
  {
    kind: "tool",
    tool: "Write",
    arg: "src/slug.js",
    result: "Created with 8 lines",
    lines: [
      add(1, "export function slugify(text) {"),
      add(2, "  return text"),
      add(3, '    .normalize("NFD")'),
      add(4, '    .replace(/[\\u0300-\\u036f]/g, "")'),
      add(5, "    .toLowerCase()"),
      add(6, '    .replace(/[^a-z0-9]+/g, "-")'),
      add(7, '    .replace(/^-|-$/g, "");'),
      add(8, "}"),
    ],
  },
  {
    kind: "tool",
    tool: "Write",
    arg: "test/slug.test.js",
    result: "Created with 15 lines",
    lines: [
      add(1, 'import assert from "node:assert/strict";'),
      add(2, 'import { test } from "node:test";'),
      add(3, 'import { slugify } from "../src/slug.js";'),
      add(4, ""),
      add(5, 'test("slugify replaces spaces with hyphens", () => {'),
      add(6, '  assert.equal(slugify("Hello World"), "hello-world");'),
      add(7, "});"),
      add(8, ""),
      add(9, 'test("slugify removes punctuation and separates words", () => {'),
      add(10, '  assert.equal(slugify("Hello, World!"), "hello-world");'),
      add(11, "});"),
      add(12, ""),
      add(13, 'test("slugify normalizes accented letters", () => {'),
      add(14, '  assert.equal(slugify("Crème brûlée"), "creme-brulee");'),
      add(15, "});"),
    ],
  },
  {
    kind: "tool",
    tool: "Edit",
    arg: "package.json",
    result: "Changed with 2 additions and 1 removal",
    lines: [
      { kind: "ctx", n: 6, text: '  "scripts": {' },
      { kind: "ctx", n: 7, text: '    "start": "node src/index.js",' },
      { kind: "del", n: 8, text: '    "test": "node --test"' },
      add(8, '    "test": "node --test",'),
      add(9, '    "test:watch": "node --test --watch"'),
      { kind: "ctx", n: 10, text: "  }" },
    ],
  },
  {
    kind: "tool",
    tool: "Bash",
    arg: "npm test",
    result: "> cli-test@1.0.0 test · 1.5s",
    lines: [
      { kind: "out", text: "> node --test" },
      { kind: "out", text: "✓ add (1.2691ms)" },
      { kind: "out", text: "✓ multiply (0.3915ms)" },
      { kind: "out", text: "✓ average of an empty list is 0 (2.4215ms)" },
      { kind: "out", text: "✓ slugify replaces spaces with hyphens (1.0877ms)" },
      { kind: "out", text: "… 10 more lines" },
    ],
  },
  {
    kind: "reply",
    paragraphs: [
      "Implemented slugify in src/slug.js. It lowercases text, converts spaces and punctuation to hyphens, and removes accents. Added tests for spaces, punctuation, and accented letters in test/slug.test.js.",
      "Added the test:watch script using Node's --watch flag. All 6 tests pass with npm test.",
    ],
  },
];

// Which rows each note covers, in order
export const NOTES: { title: string; body: string; upTo: number }[] = [
  {
    title: "Looks around first",
    body: "It finds the project files and reads the ones that matter before writing anything.",
    upTo: 5,
  },
  {
    title: "Checks the docs",
    body: "For the watch flag it searches the Node docs instead of guessing.",
    upTo: 6,
  },
  {
    title: "Writes the code and the tests",
    body: "A new slug.js, and tests for spaces, punctuation and accents.",
    upTo: 8,
  },
  { title: "Edits what is already there", body: "One small change to package.json.", upTo: 9 },
  { title: "Runs the tests", body: "It runs npm test itself and reads the output.", upTo: 10 },
  { title: "Reports back", body: "What changed, and proof that it works.", upTo: 11 },
];
