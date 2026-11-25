import OpenAI from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses";
import {
  emptyUsage,
  type HistoryItem,
  type ModelClient,
  type ModelEvent,
  type ModelRequest,
  type Usage,
} from "./types.js";

export interface OpenAIModelClientOptions {
  apiKey: string;
  baseURL?: string;
}

function toUsage(usage: ResponseUsage | undefined): Usage {
  if (!usage) return emptyUsage();
  return {
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details.cached_tokens,
    outputTokens: usage.output_tokens,
  };
}

export class OpenAIModelClient implements ModelClient {
  readonly #client: OpenAI;

  constructor(options: OpenAIModelClientOptions) {
    this.#client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  // Stream one stateless model call
  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
    const stream = await this.#client.responses.create(
      {
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        tools: request.tools?.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: true,
        })),
        prompt_cache_key: request.promptCacheKey,
        include: ["reasoning.encrypted_content"],
        store: false,
        stream: true,
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        yield { type: "text_delta", text: event.delta };
      } else if (event.type === "response.completed") {
        yield {
          type: "completed",
          output: event.response.output as HistoryItem[],
          usage: toUsage(event.response.usage),
        };
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "Model response failed");
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
}
