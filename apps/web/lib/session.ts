// A real Nimbus session on a small demo API, recorded 28 Nov 2026

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
  "Customers report that GET /orders?status=PAID returns a 500 error, while status=paid works. Find the cause, fix it, add a regression test, and make sure the whole test suite passes.";

const add = (n: number, text: string): Line => ({ kind: "add", n, text });
const out = (text: string): Line => ({ kind: "out", text });

export const ROWS: Row[] = [
  {
    kind: "tool",
    tool: "Todos",
    arg: "",
    result: "Updated the list, 0 of 3 done",
    lines: [
      out("◐ Trace order status filtering and identify why uppercase status causes a 500"),
      out("☐ Fix the filtering behavior and add a regression test"),
      out("☐ Run the full test suite and review the changes"),
    ],
  },
  {
    kind: "tool",
    tool: "Glob",
    arg: "**/*order*",
    result: "Found 4 files",
  },
  {
    kind: "tool",
    tool: "Grep",
    arg: '"status|GET /orders|/orders"',
    result: "Found 6 files",
  },
  {
    kind: "tool",
    tool: "Glob",
    arg: "**/{package.json,pyproject.toml,go.mod,Cargo.toml,pom.xml,build.gradle}",
    result: "Found 1 file",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "src/routes/orders.js (lines 1-200)",
    result: "Read 11 lines",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "src/services/orders.js (lines 1-240)",
    result: "Read 15 lines",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "src/data/orders.js (lines 1-240)",
    result: "Read 6 lines",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "test/orders.test.js (lines 1-300)",
    result: "Read 21 lines",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "package.json (lines 1-180)",
    result: "Read 9 lines",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "src/server.js (lines 1-220)",
    result: "Read 20 lines",
  },
  {
    kind: "tool",
    tool: "Todos",
    arg: "",
    result: "Updated the list, 1 of 3 done",
    lines: [
      out("☑ Trace order status filtering and identify why uppercase status causes a 500"),
      out("◐ Fix the filtering behavior and add a regression test"),
      out("☐ Run the full test suite and review the changes"),
    ],
  },
  {
    kind: "tool",
    tool: "Edit",
    arg: "src/services/orders.js",
    result: "Changed with 3 additions and 2 removals",
    lines: [
      { kind: "ctx", n: 6, text: "" },
      { kind: "ctx", n: 7, text: "export function filterByStatus(orders, status) {" },
      { kind: "ctx", n: 8, text: "  if (!status) return orders;" },
      { kind: "del", n: 9, text: "  const { label } = STATUSES[status];" },
      { kind: "del", n: 10, text: "  return orders.filter((order) => order.status === label);" },
      add(9, "  const statusConfig = STATUSES[status.toLowerCase()];"),
      add(10, "  if (!statusConfig) return [];"),
      add(11, "  return orders.filter((order) => order.status === statusConfig.label);"),
      { kind: "ctx", n: 12, text: "}" },
      { kind: "ctx", n: 13, text: "" },
      { kind: "ctx", n: 14, text: "export function findOrder(orders, id) {" },
    ],
  },
  {
    kind: "tool",
    tool: "Edit",
    arg: "test/orders.test.js",
    result: "Changed with 1 addition",
    lines: [
      { kind: "ctx", n: 1, text: 'import assert from "node:assert/strict";' },
      { kind: "ctx", n: 2, text: 'import { test } from "node:test";' },
      { kind: "ctx", n: 3, text: 'import { orders } from "../src/data/orders.js";' },
      add(4, 'import { handleOrders } from "../src/routes/orders.js";'),
      {
        kind: "ctx",
        n: 5,
        text: 'import { filterByStatus, findOrder } from "../src/services/orders.js";',
      },
      { kind: "ctx", n: 6, text: "" },
      { kind: "ctx", n: 7, text: 'test("returns every order without a status", () => {' },
    ],
  },
  {
    kind: "tool",
    tool: "Edit",
    arg: "test/orders.test.js",
    result: "Changed with 10 additions",
    lines: [
      { kind: "ctx", n: 16, text: "  );" },
      { kind: "ctx", n: 17, text: "});" },
      { kind: "ctx", n: 18, text: "" },
      add(19, 'test("GET /orders accepts uppercase status values", () => {'),
      add(20, '  const result = handleOrders(new URL("http://localhost/orders?status=PAID"));'),
      add(21, ""),
      add(22, "  assert.equal(result.status, 200);"),
      add(23, "  assert.deepEqual("),
      add(24, "    result.body.map((order) => order.id),"),
      add(25, '    ["ord_1001", "ord_1003"],'),
      add(26, "  );"),
      add(27, "});"),
      add(28, ""),
      { kind: "ctx", n: 29, text: 'test("finds one order by id", () => {' },
      {
        kind: "ctx",
        n: 30,
        text: '  assert.equal(findOrder(orders, "ord_1002").customer, "Rohan Mehta");',
      },
      { kind: "ctx", n: 31, text: '  assert.equal(findOrder(orders, "ord_9999"), null);' },
    ],
  },
  {
    kind: "tool",
    tool: "Todos",
    arg: "",
    result: "Updated the list, 2 of 3 done",
    lines: [
      out("☑ Trace order status filtering and identify why uppercase status causes a 500"),
      out("☑ Fix the filtering behavior and add a regression test"),
      out("◐ Run the full test suite and review the changes"),
    ],
  },
  {
    kind: "tool",
    tool: "Bash",
    arg: "npm test",
    result: "> orders-api@1.2.0 test",
    lines: [
      out("> node --test"),
      out("TAP version 13"),
      out("# Subtest: returns every order without a status"),
      out("ok 1 - returns every order without a status"),
      out("  ---"),
      out("… 30 more lines"),
    ],
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "src/services/orders.js (lines 1-50)",
    result: "Read 16 lines",
  },
  {
    kind: "tool",
    tool: "Read",
    arg: "test/orders.test.js (lines 1-80)",
    result: "Read 32 lines",
  },
  {
    kind: "tool",
    tool: "Todos",
    arg: "",
    result: "Updated the list, 3 of 3 done",
    lines: [
      out("☑ Trace order status filtering and identify why uppercase status causes a 500"),
      out("☑ Fix the filtering behavior and add a regression test"),
      out("☑ Run the full test suite and review the changes"),
    ],
  },
  {
    kind: "reply",
    paragraphs: [
      'The 500 was caused by looking up `STATUSES["PAID"]`, which returned `undefined` and threw during destructuring. Status filtering now normalizes input to lowercase; unrecognized statuses return no matches instead of causing an error (`src/services/orders.js:7`).',
      "Added a regression test for `GET /orders?status=PAID` (`test/orders.test.js:19`). The full test suite passes: 4 tests, 0 failures.",
    ],
  },
];

// Which rows each note covers, in order
export const NOTES: { title: string; body: string; upTo: number }[] = [
  { title: "Plans the work", body: "A short checklist, ticked off as it goes.", upTo: 1 },
  {
    title: "Looks around first",
    body: "It reads the route, the service and the tests before changing anything.",
    upTo: 10,
  },
  {
    title: "Fixes the cause",
    body: "Uppercase status values no longer crash the lookup.",
    upTo: 12,
  },
  { title: "Adds a regression test", body: "So the same bug cannot quietly come back.", upTo: 14 },
  { title: "Runs the tests", body: "It runs npm test itself and reads the result.", upTo: 16 },
  { title: "Reports back", body: "What broke, what changed, and proof that it works.", upTo: 20 },
];
