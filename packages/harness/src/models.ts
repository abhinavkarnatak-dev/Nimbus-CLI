// How long the model thinks before answering
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
  id: string;
  blurb: string;
  efforts: readonly ReasoningEffort[];
  // Superseded by a newer version
  older?: boolean;
}

const ALL: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
const THINKING: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

export const MODELS: readonly ModelInfo[] = [
  {
    id: "gpt-6.2-astra",
    blurb: "Most capable, for the hardest coding and long projects",
    efforts: THINKING,
  },
  {
    id: "gpt-6.2-sol",
    blurb: "Balanced intelligence and cost for everyday coding",
    efforts: THINKING,
  },
  {
    id: "gpt-6.1-terra",
    blurb: "Fast and efficient, good at writing and visual tasks",
    efforts: ALL,
  },
  { id: "gpt-6-luna", blurb: "Fastest and cheapest, for focused tasks", efforts: ALL },
  { id: "gpt-6-astra", blurb: "Previous Astra", efforts: THINKING, older: true },
  { id: "gpt-6.1-sol", blurb: "Previous Sol", efforts: THINKING, older: true },
];

export const DEFAULT_MODEL = "gpt-6-luna";
export const DEFAULT_EFFORT: ReasoningEffort = "medium";

export const EFFORT_HINTS: Record<ReasoningEffort, string> = {
  none: "No thinking, fastest",
  low: "Quick thinking",
  medium: "Balanced",
  high: "Thinks longer for harder tasks",
  xhigh: "Thinks much longer",
  max: "Thinks as long as it needs, slowest",
};

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}

// A level this model accepts, falling back to medium
export function effortFor(model: string, effort: ReasoningEffort | undefined): ReasoningEffort {
  const efforts = modelInfo(model)?.efforts ?? ALL;
  if (effort && efforts.includes(effort)) return effort;
  return efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : efforts[0]!;
}
