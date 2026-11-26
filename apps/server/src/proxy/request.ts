import { z } from "zod";

export const ALLOWED_MODELS = ["gpt-6-luna", "gpt-6.1-terra"] as const;
const ALLOWED_INCLUDE = ["reasoning.encrypted_content"] as const;

// Fields we forward, everything else is dropped
export const responsesRequestSchema = z.object({
  model: z.enum(ALLOWED_MODELS),
  input: z.union([z.string(), z.array(z.unknown())]),
  instructions: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  include: z.array(z.enum(ALLOWED_INCLUDE)).optional(),
  prompt_cache_key: z.string().max(128).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  reasoning: z
    .object({ effort: z.enum(["minimal", "low", "medium", "high"]).optional() })
    .optional(),
  text: z.unknown().optional(),
  store: z.boolean().optional(),
  stream: z.literal(true, { error: "Only streaming requests are supported." }),
});

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

// Apply server rules on top of the request
export function upstreamBody(request: ResponsesRequest, maxOutputTokens: number) {
  return {
    ...request,
    store: false,
    max_output_tokens: Math.min(request.max_output_tokens ?? maxOutputTokens, maxOutputTokens),
  };
}
