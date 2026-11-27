import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_DOC_CHARS } from "./project.js";
import { BUILT_IN_SKILLS } from "./builtin-skills.js";

export type SkillSource = "project" | "personal" | "built-in";

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  // Null for skills that ship with Nimbus
  folder: string | null;
  source: SkillSource;
  // False when only the user may run it
  modelCanUse: boolean;
}

export const MAX_LISTED_SKILLS = 50;
export const MAX_SKILL_DESCRIPTION = 200;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const unquote = (value: string) => (/^(["']).*\1$/.test(value) ? value.slice(1, -1) : value);

// The few flat fields a SKILL.md header needs
export function parseSkillFile(
  text: string,
): { fields: Record<string, string>; body: string } | null {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      key = pair[1]!.toLowerCase();
      const value = pair[2]!.trim();
      fields[key] = /^[>|][+-]?$/.test(value) ? "" : unquote(value);
    } else if (key && /^\s+\S/.test(line)) {
      // Indented lines continue the value above
      fields[key] = `${fields[key] ? `${fields[key]} ` : ""}${line.trim()}`;
    }
  }
  return { fields, body: (match[2] ?? "").trim() };
}

function cutInstructions(body: string): string {
  return body.length > MAX_DOC_CHARS
    ? `${body.slice(0, MAX_DOC_CHARS)}\n\n[This skill was cut at ${MAX_DOC_CHARS.toLocaleString("en-US")} characters. The rest is in SKILL.md in the skill's folder.]`
    : body;
}

// Every <name>/SKILL.md in one skills folder
function readSkillFolder(dir: string, source: SkillSource): Skill[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const folderName of names) {
    const folder = join(dir, folderName);
    let parsed: ReturnType<typeof parseSkillFile>;
    try {
      parsed = parseSkillFile(readFileSync(join(folder, "SKILL.md"), "utf8"));
    } catch {
      continue;
    }
    if (!parsed) continue;
    const name = (parsed.fields.name || folderName).trim();
    const description = (parsed.fields.description ?? "").replace(/\s+/g, " ").trim();
    if (!SKILL_NAME.test(name) || name.length > 64 || !description || !parsed.body) continue;
    skills.push({
      name,
      description,
      instructions: cutInstructions(parsed.body),
      folder,
      source,
      modelCanUse: parsed.fields["disable-model-invocation"]?.toLowerCase() !== "true",
    });
  }
  return skills;
}

// Project skills win over personal, personal over built-in
export function loadSkills(cwd: string, home: string): Skill[] {
  const all = [
    ...readSkillFolder(join(cwd, ".nimbus", "skills"), "project"),
    ...readSkillFolder(join(home, ".nimbus", "skills"), "personal"),
    ...BUILT_IN_SKILLS,
  ];
  const seen = new Set<string>();
  return all.filter((skill) => !seen.has(skill.name) && seen.add(skill.name));
}

function shortDescription(text: string): string {
  return text.length > MAX_SKILL_DESCRIPTION
    ? `${text.slice(0, MAX_SKILL_DESCRIPTION - 3).trimEnd()}...`
    : text;
}

// Seen by the model: names and descriptions only
export function skillsSection(skills: readonly Skill[] | undefined): string {
  const usable = (skills ?? []).filter((skill) => skill.modelCanUse).slice(0, MAX_LISTED_SKILLS);
  if (usable.length === 0) return "";
  const list = usable
    .map((skill) => `- ${skill.name}: ${shortDescription(skill.description)}`)
    .join("\n");
  return `

Skills:
Skills are saved instructions for specific kinds of tasks, written by the user or for this
project. Only each skill's name and a short description are listed here. When the user's
request matches a skill's description, call load_skill with its name before you start the
work, then follow the instructions it returns for the rest of the task. Do not guess what a
skill says without loading it. If no skill fits the request, work as usual.
${list}`;
}

const REQUEST_START = (name: string) =>
  `The user ran the skill "${name}" by typing /${name}. Follow these instructions for this request:`;

// Sent as the user's message for "/name text"
export function skillRequest(skill: Skill, args = ""): string {
  const added = args.trim();
  // Built-in text may mention $ARGUMENTS on purpose
  const replace = skill.source !== "built-in" && skill.instructions.includes("$ARGUMENTS");
  const body = replace ? skill.instructions.replaceAll("$ARGUMENTS", added) : skill.instructions;
  const extra = added && !replace ? `\n\nThe user added: ${added}` : "";
  return `${REQUEST_START(skill.name)}\n\n${body}${extra}`;
}

// What the user typed, for showing a saved request again
export function parseSkillRequest(text: string): string | null {
  const match =
    /^The user ran the skill "([a-z0-9-]+)" by typing \/\1\. Follow these instructions for this request:\n/.exec(
      text,
    );
  if (!match) return null;
  const added = /\n\nThe user added: ([^\n]*)$/.exec(text);
  return added ? `/${match[1]} ${added[1]}` : `/${match[1]}`;
}
