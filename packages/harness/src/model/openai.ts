import OpenAI from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses";
import { ConnectionLostError, isNetworkError } from "./retry.js";
import {
  emptyUsage,
  type HistoryItem,
  type ModelClient,
  type ModelEvent,
  type ModelRequest,
  type Usage,
} from "./types.js";

// Time to get the first byte back, not the whole reply
const CONNECT_TIMEOUT_MS = 60_000;

export interface OpenAIModelClientOptions {
  apiKey: string;
  baseURL?: string;
  // Fail the stream when no bytes arrive for this long
  idleTimeoutMs?: number;
  fetch?: typeof fetch;
}

function toUsage(usage: ResponseUsage | undefined): Usage {
  if (!usage) return emptyUsage();
  return {
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens ?? 0,
    outputTokens: usage.output_tokens,
  };
}

function withCode(message: string, code: string | null | undefined): Error {
  return code ? Object.assign(new Error(message), { code }) : new Error(message);
}

// Cut short on purpose, so retrying would not help
function incompleteMessage(reason: string | undefined): string {
  if (reason === "max_output_tokens") return "The reply got too long and was cut off.";
  if (reason === "content_filter") return "The reply was blocked by the content filter.";
  return `The model stopped before finishing (${reason ?? "no reason given"}).`;
}

// Fails a body that goes quiet, so a dead connection never hangs
export function idleFetch(idleMs: number, base?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await (base ?? fetch)(input, init);
    if (!res.body) return res;
    const reader = res.body.getReader();
    const stalled = () =>
      new ConnectionLostError(`No data from the server for ${Math.round(idleMs / 1000)}s.`);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let quiet = false;
        const timer = setTimeout(() => {
          quiet = true;
          reader.cancel().catch(() => {});
        }, idleMs);
        try {
          const { done, value } = await reader.read();
          if (quiet) controller.error(stalled());
          else if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          controller.error(quiet ? stalled() : error);
        } finally {
          clearTimeout(timer);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

export class OpenAIModelClient implements ModelClient {
  readonly #client: OpenAI;

  constructor(options: OpenAIModelClientOptions) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      // The session retries, so the SDK must not
      maxRetries: 0,
      timeout: CONNECT_TIMEOUT_MS,
      fetch: options.idleTimeoutMs
        ? idleFetch(options.idleTimeoutMs, options.fetch)
        : options.fetch,
    });
  }

  // Stream one stateless model call
  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
    try {
      yield* this.#stream(request, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof OpenAI.APIConnectionError || isNetworkError(error)) {
        throw new ConnectionLostError((error as Error).message, { cause: error });
      }
      throw error;
    }
  }

  async *#stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
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
        ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
        prompt_cache_key: request.promptCacheKey,
        include: ["reasoning.encrypted_content"],
        store: false,
        stream: true,
      },
      { signal },
    );

    let completed = false;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        yield { type: "text_delta", text: event.delta };
      } else if (event.type === "response.completed") {
        completed = true;
        yield {
          type: "completed",
          output: event.response.output as HistoryItem[],
          usage: toUsage(event.response.usage),
        };
      } else if (event.type === "response.incomplete") {
        throw new Error(incompleteMessage(event.response.incomplete_details?.reason));
      } else if (event.type === "response.failed") {
        const failure = event.response.error;
        throw withCode(failure?.message ?? "Model response failed", failure?.code);
      } else if (event.type === "error") {
        throw withCode(event.message, event.code);
      }
    }
    if (completed) return;
    signal?.throwIfAborted();
    // The SDK ends quietly when the connection is cut
    throw new ConnectionLostError("The connection closed before the reply finished.");
  }
}
