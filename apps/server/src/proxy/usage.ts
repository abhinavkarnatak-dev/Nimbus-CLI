export interface UpstreamUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export type StreamEnd =
  | { kind: "finished"; status: string; usage: UpstreamUsage | null }
  | { kind: "no_final_event" }
  | { kind: "cancelled" }
  | { kind: "upstream_error"; message: string };

const FINAL_EVENTS = new Set(["response.completed", "response.incomplete", "response.failed"]);

// Events whose delta is text the model produced
const DELTA_EVENTS = new Set([
  "response.output_text.delta",
  "response.function_call_arguments.delta",
  "response.reasoning_summary_text.delta",
]);

function readUsage(
  response: { usage?: Record<string, unknown> } | undefined,
): UpstreamUsage | null {
  const usage = response?.usage;
  if (!usage) return null;
  const details = usage.input_tokens_details as { cached_tokens?: number } | undefined;
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    cachedTokens: Number(details?.cached_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
  };
}

// Finds the final event in a server-sent event stream
export class FinalEventScanner {
  #decoder = new TextDecoder();
  #buffer = "";
  final: Extract<StreamEnd, { kind: "finished" }> | null = null;
  streamedChars = 0;

  push(chunk: Uint8Array): void {
    this.#scan(this.#decoder.decode(chunk, { stream: true }));
  }

  end(): void {
    this.#scan(this.#decoder.decode() + "\n\n");
  }

  #scan(text: string): void {
    this.#buffer += text.replace(/\r\n/g, "\n");
    let boundary = this.#buffer.indexOf("\n\n");
    while (boundary !== -1) {
      this.#readBlock(this.#buffer.slice(0, boundary));
      this.#buffer = this.#buffer.slice(boundary + 2);
      boundary = this.#buffer.indexOf("\n\n");
    }
  }

  #readBlock(block: string): void {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data.includes("response.")) return;
    try {
      const event = JSON.parse(data) as {
        type?: string;
        delta?: unknown;
        response?: { status?: string; usage?: Record<string, unknown> };
      };
      if (event.type && DELTA_EVENTS.has(event.type) && typeof event.delta === "string") {
        this.streamedChars += event.delta.length;
      }
      if (event.type && FINAL_EVENTS.has(event.type)) {
        this.final = {
          kind: "finished",
          status: event.response?.status ?? event.type,
          usage: readUsage(event.response),
        };
      }
    } catch {
      // Not JSON, skip it
    }
  }
}

// Relay upstream bytes as they are and report how the stream ended
export function relay(
  upstream: ReadableStream<Uint8Array>,
  onEnd: (end: StreamEnd, streamedChars: number) => void,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const scanner = new FinalEventScanner();
  let ended = false;
  const finish = (end: StreamEnd) => {
    if (ended) return;
    ended = true;
    onEnd(end, scanner.streamedChars);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          scanner.end();
          finish(scanner.final ?? { kind: "no_final_event" });
          controller.close();
          return;
        }
        scanner.push(value);
        controller.enqueue(value);
      } catch (error) {
        finish({ kind: "upstream_error", message: (error as Error).message });
        controller.error(error);
      }
    },
    // Client went away, stop the model too
    async cancel(reason) {
      finish({ kind: "cancelled" });
      await reader.cancel(reason).catch(() => {});
    },
  });
}
