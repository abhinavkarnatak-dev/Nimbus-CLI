import { z } from "zod";

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
  summary?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool extends ToolSpec {
  execute(rawArgs: string, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinition<Input> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  run(input: Input, ctx: ToolContext): Promise<ToolResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Wrap tool with parsing and validation
export function defineTool<Input>(definition: ToolDefinition<Input>): Tool {
  const parameters = { ...z.toJSONSchema(definition.schema) } as Record<string, unknown>;
  delete parameters.$schema;

  return {
    name: definition.name,
    description: definition.description,
    parameters,
    async execute(rawArgs, ctx) {
      let json: unknown;
      try {
        json = JSON.parse(rawArgs);
      } catch {
        return { output: "Error: arguments were not valid JSON.", isError: true };
      }

      const parsed = definition.schema.safeParse(json);
      if (!parsed.success) {
        return {
          output: `Error: invalid arguments.\n${z.prettifyError(parsed.error)}`,
          isError: true,
        };
      }

      try {
        return await definition.run(parsed.data, ctx);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { output: `Error: ${errorMessage(error)}`, isError: true };
      }
    },
  };
}
