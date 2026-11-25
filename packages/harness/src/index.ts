export const HARNESS_VERSION = "0.0.0";

export { Session, type SessionOptions } from "./agent/session.js";
export type { AgentEvent } from "./agent/events.js";
export { OpenAIModelClient, type OpenAIModelClientOptions } from "./model/openai.js";
export { FakeModelClient, type FakeTurn } from "./model/fake.js";
export {
  emptyUsage,
  type HistoryItem,
  type ModelClient,
  type ModelEvent,
  type ModelRequest,
  type Usage,
} from "./model/types.js";
export { costOf, MODEL_PRICES, type ModelPrice } from "./cost.js";
export { buildSystemPrompt, detectEnvironment, type Environment } from "./prompt/system.js";
