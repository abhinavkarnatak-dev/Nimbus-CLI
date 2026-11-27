import { z } from "zod";
import { looksSecret } from "./secrets.js";
import { defineTool } from "./types.js";

export type MemoryScope = "user" | "project";

// Where saved facts live; the CLI keeps them in files
export interface MemoryBook {
  save(fact: string, scope: MemoryScope): "saved" | "duplicate" | "full";
}

const schema = z.strictObject({
  fact: z.string().min(3).max(300),
  scope: z.enum(["user", "project"]),
});

export const rememberTool = defineTool({
  name: "remember",
  description: `Save a short fact to remember in future conversations with this user. Saved facts are
loaded at the start of every new session.
Use it when the user asks you to remember something, or states a lasting preference or
fact that will matter again: how they like answers, tools they use, how they test, or a
project convention. Do not use it for one-off details of the current task, things already
in AGENTS.md, or anything secret (passwords, keys, tokens).
- fact: one short sentence that makes sense later without this conversation, for example
  "The user tests everything with node --test".
- scope: "user" for facts about the user that apply in every project, "project" for facts
  about this project only.`,
  schema,
  // Save a fact for later sessions
  async run({ fact, scope }, ctx) {
    if (!ctx.memory) throw new Error("memory is not available in this session");
    if (looksSecret(fact)) {
      return {
        output:
          "Not saved: this looks like a secret (a password, key or token). Never store secrets in memory.",
        summary: "not saved, looks secret",
        isError: true,
      };
    }
    const result = ctx.memory.save(fact.trim(), scope);
    const where = scope === "user" ? "user" : "project";
    if (result === "duplicate")
      return { output: `Already in ${where} memory.`, summary: "already saved" };
    if (result === "full") {
      return {
        output: `Not saved: ${where} memory is full. Ask the user to remove old facts with /memory forget.`,
        summary: "memory full",
        isError: true,
      };
    }
    return {
      output: `Saved to ${where} memory. It will be loaded at the start of future sessions.`,
      summary: `saved to ${where} memory`,
      preview: fact.trim(),
    };
  },
});
