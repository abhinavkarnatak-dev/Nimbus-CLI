import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import OpenAI from "openai";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses";

const MODEL = "gpt-6-luna";
// USD per 1M tokens
const PRICE = { input: 0.1, cached: 0.01, output: 0.5 };

const client = new OpenAI();
let totalCost = 0;

function costOf(usage: ResponseUsage): number {
  const cached = usage.input_tokens_details.cached_tokens;
  const uncached = usage.input_tokens - cached;
  return (
    (uncached * PRICE.input + cached * PRICE.cached + usage.output_tokens * PRICE.output) /
    1_000_000
  );
}

function printUsage(label: string, usage: ResponseUsage | undefined): void {
  if (!usage) throw new Error(`${label}: response had no usage`);
  totalCost += costOf(usage);
  console.log(
    `[${label}] in=${usage.input_tokens} (cached=${usage.input_tokens_details.cached_tokens}) out=${usage.output_tokens} cost=$${costOf(usage).toFixed(6)}`,
  );
}

// Test 1: streamed text
async function testStreaming(): Promise<string> {
  const stream = await client.responses.create({
    model: MODEL,
    input: "Explain what a CLI is in two sentences.",
    stream: true,
    store: false,
  });

  let chunks = 0;
  let usage: ResponseUsage | undefined;
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      process.stdout.write(event.delta);
      chunks++;
    } else if (event.type === "response.completed") {
      usage = event.response.usage;
    }
  }
  process.stdout.write("\n");

  printUsage("stream", usage);
  if (chunks < 2) throw new Error(`expected many chunks, got ${chunks}`);
  return `${chunks} chunks`;
}

const tools: FunctionTool[] = [
  {
    type: "function",
    name: "count_lines",
    description: "Count the number of lines in a text file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function countLines(path: string): Promise<number> {
  const text = await readFile(path, "utf8");
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/);
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

// Run tool, never throw
async function runTool(call: ResponseFunctionToolCall): Promise<string> {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return "Error: arguments were not valid JSON";
  }

  if (call.name !== "count_lines") return `Error: unknown tool ${call.name}`;

  const path = (args as { path?: unknown } | null)?.path;
  if (typeof path !== "string") return "Error: path must be a string";

  try {
    return String(await countLines(path));
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Test 2: tool call round trip
async function testToolCalling(): Promise<string> {
  const input: ResponseInputItem[] = [
    { role: "user", content: "How many lines are in README.md? Use the tool." },
  ];

  const first = await client.responses.create({
    model: MODEL,
    input,
    tools,
    store: false,
    include: ["reasoning.encrypted_content"],
  });
  printUsage("tools round 1", first.usage);

  input.push(...(first.output as ResponseInputItem[]));

  const calls = first.output.filter(
    (item): item is ResponseFunctionToolCall => item.type === "function_call",
  );
  if (calls.length === 0) throw new Error("model answered without calling the tool");

  for (const call of calls) {
    console.log(`  -> ${call.name}(${call.arguments}) [${call.call_id}]`);
    const output = await runTool(call);
    console.log(`  <- ${output}`);
    input.push({ type: "function_call_output", call_id: call.call_id, output });
  }

  const second = await client.responses.create({
    model: MODEL,
    input,
    tools,
    store: false,
    include: ["reasoning.encrypted_content"],
  });
  printUsage("tools round 2", second.usage);
  console.log(second.output_text);

  const expected = String(await countLines("README.md"));
  if (!second.output_text.includes(expected)) {
    throw new Error(`expected the answer to mention ${expected}`);
  }
  return `${calls.length} tool call(s), answer has ${expected}`;
}

// Test 3: image input
async function testImage(): Promise<string> {
  const bytes = await readFile("scripts/fixtures/check.png");
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  const response = await client.responses.create({
    model: MODEL,
    store: false,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "What text is written in this image, and what shape and color is on the left?",
          },
          { type: "input_image", image_url: dataUrl, detail: "low" },
        ],
      },
    ],
  });
  printUsage("image", response.usage);
  console.log(response.output_text);

  const answer = response.output_text.toLowerCase();
  if (!answer.includes("nimbus") || !answer.includes("42")) {
    throw new Error("answer did not read NIMBUS 42");
  }
  return "read NIMBUS 42";
}

const LONG_INSTRUCTIONS = Array.from(
  { length: 60 },
  (_, i) =>
    `Rule ${i + 1}: Always answer briefly, prefer plain words, and never invent file contents you have not read.`,
).join("\n");

// Test 4: prompt caching
async function testCaching(): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await client.responses.create({
      model: MODEL,
      instructions: LONG_INSTRUCTIONS,
      input: "Say OK.",
      store: false,
      prompt_cache_key: "nimbus-model-check",
    });
    printUsage(`cache call ${attempt}`, response.usage);

    const cached = response.usage?.input_tokens_details.cached_tokens ?? 0;
    if (attempt > 1 && cached > 0) return `cached ${cached} tokens`;
    await sleep(2000);
  }
  throw new Error("no cached tokens after 3 calls");
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<string>]> = [
    ["streaming", testStreaming],
    ["tools", testToolCalling],
    ["image", testImage],
    ["caching", testCaching],
  ];

  const results: Array<[string, string, string]> = [];
  for (const [name, run] of tests) {
    console.log(`\n=== ${name}`);
    try {
      results.push([name, "PASS", await run()]);
    } catch (error) {
      results.push([name, "FAIL", error instanceof Error ? error.message : String(error)]);
    }
  }

  console.log("\n=== summary");
  for (const [name, status, detail] of results) {
    console.log(`${name.padEnd(10)} ${status}  ${detail}`);
  }
  console.log(`total cost $${totalCost.toFixed(6)}`);

  if (results.some(([, status]) => status === "FAIL")) process.exitCode = 1;
}

await main();
