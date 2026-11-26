export const SSE_EVENTS = [
  { type: "response.created", response: { status: "in_progress" } },
  { type: "response.output_text.delta", delta: "Hello" },
  { type: "response.output_text.delta", delta: " there" },
  {
    type: "response.completed",
    response: {
      status: "completed",
      usage: {
        input_tokens: 1200,
        input_tokens_details: { cached_tokens: 1000 },
        output_tokens: 40,
      },
    },
  },
];

export const sse = (event: unknown) => `event: x\ndata: ${JSON.stringify(event)}\n\n`;

export interface UpstreamCall {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

interface FakeOptions {
  status?: number;
  errorBody?: string;
  chunks?: string[];
  // Keep the stream open after the chunks
  hang?: boolean;
  throws?: boolean;
}

// A stand-in for the OpenAI endpoint
export function fakeUpstream(options: FakeOptions = {}) {
  const calls: UpstreamCall[] = [];
  const state = { cancelled: false };
  const encoder = new TextEncoder();

  const fetchUpstream = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    });
    if (options.throws) throw new Error("connect ECONNREFUSED");
    if (options.status && options.status !== 200) {
      return new Response(options.errorBody ?? '{"error":{"message":"upstream says no"}}', {
        status: options.status,
        headers: { "content-type": "application/json" },
      });
    }
    const chunks = options.chunks ?? SSE_EVENTS.map(sse);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (!options.hang) controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;

  return { fetchUpstream, calls, state };
}
