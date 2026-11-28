// Cheap and quick: titles never need deep thought
export const TITLE_MODEL = "gpt-6-luna";
export const TITLE_MESSAGES = 5;
const MESSAGE_CHARS = 300;
const MAX_TITLE_CHARS = 80;

// Seen by the model: asks for a short title or NONE
export function titleRequest(messages: readonly string[]): string {
  const list = messages
    .slice(0, TITLE_MESSAGES)
    .map((text, index) => {
      const clean = text.replace(/\s+/g, " ").trim();
      const cut = clean.length > MESSAGE_CHARS ? `${clean.slice(0, MESSAGE_CHARS)}...` : clean;
      return `${index + 1}. ${cut}`;
    })
    .join("\n");
  return `Write a short title for a conversation between a user and a coding agent, based on the
user's messages below. The title should say what the user is working on or asking about,
in 3 to 6 words, in sentence case, with no quotes and no full stop at the end. Examples:
"Fix login redirect bug", "Count lines in JS files", "Set up Postgres with Drizzle".
If the messages are only greetings, small talk or too vague to tell what the user wants,
answer with exactly NONE.

User's messages:
${list}`;
}

// The model's answer as a title, or null for NONE
export function parseTitle(text: string): string | null {
  const line = text.trim().split("\n")[0]!.trim();
  const title = line
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (!title || /^none$/i.test(title)) return null;
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).trimEnd() : title;
}
