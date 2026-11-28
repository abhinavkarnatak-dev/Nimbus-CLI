import { parseSkillRequest } from "@nimbus/harness";
import { COMMIT_REQUEST, INIT_REQUEST, parseCommitRequest } from "./commands.js";

// Saved before 0.1.2, when it said "coding agents"
const OLD_INIT_REQUEST = INIT_REQUEST.replace(
  "for AI agents like you",
  "for coding agents like you",
);

// What the user typed, for a request Nimbus wrote for them
export function shownMessage(text: string): string {
  if (text === INIT_REQUEST || text === OLD_INIT_REQUEST) return "/init";
  return parseSkillRequest(text) ?? parseCommitRequest(text) ?? text;
}

// Titles saved before real titles: the start of a hidden request
export function shownTitle(title: string): string {
  if (title.length >= 40 && INIT_REQUEST.startsWith(title)) return "/init";
  if (title.length >= 40 && COMMIT_REQUEST.startsWith(title)) return "/commit";
  const skill = /^The user ran the skill "([a-z0-9-]+)"/.exec(title);
  return skill ? `/${skill[1]}` : title;
}
