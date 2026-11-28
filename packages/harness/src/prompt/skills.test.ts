import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTracker } from "../tools/file-state.js";
import { editTool } from "../tools/edit.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";
import { loadSkillTool } from "../tools/skill.js";
import { buildSystemPrompt } from "./system.js";
import {
  loadSkills,
  parseSkillFile,
  parseSkillRequest,
  skillRequest,
  skillsSection,
  type Skill,
} from "./skills.js";

const env = { os: "Linux", shell: "bash", cwd: "/p", date: "2026-11-28" };

async function addSkill(root: string, folder: string, text: string) {
  await mkdir(join(root, ".nimbus", "skills", folder), { recursive: true });
  await writeFile(join(root, ".nimbus", "skills", folder, "SKILL.md"), text);
}

const skillFile = (name: string, description: string, body: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}\n`;

const ctxWith = (cwd: string, skills: readonly Skill[]) => ({
  cwd,
  signal: new AbortController().signal,
  files: new FileTracker(),
  skills,
});

describe("skills", () => {
  it("reads the header, including quoted and folded descriptions", () => {
    expect(parseSkillFile(`---\nname: review\ndescription: "Check changes"\n---\nDo it.`)).toEqual({
      fields: { name: "review", description: "Check changes" },
      body: "Do it.",
    });
    const folded = parseSkillFile(`---\ndescription: >\n  Write release\n  notes\n---\nSteps`);
    expect(folded?.fields.description).toBe("Write release notes");
    expect(parseSkillFile("no header here")).toBeNull();
  });

  it("loads project, personal and built-in skills, the project one winning a clash", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-skills-proj-"));
    const home = await mkdtemp(join(tmpdir(), "nimbus-skills-home-"));
    await addSkill(cwd, "review", skillFile("review", "Project review", "Project steps"));
    await addSkill(home, "review", skillFile("review", "Personal review", "Personal steps"));
    await addSkill(
      home,
      "deploy",
      skillFile("deploy", "Deploy the app", "Run deploy", "disable-model-invocation: true\n"),
    );
    await addSkill(home, "Bad Name", skillFile("Bad Name", "x", "y"));
    await addSkill(home, "empty", "---\nname: empty\n---\nNo description");
    const skills = loadSkills(cwd, home);
    expect(skills.map((skill) => [skill.name, skill.source, skill.modelCanUse])).toEqual([
      ["review", "project", true],
      ["deploy", "personal", false],
      ["create-skill", "built-in", true],
    ]);
    expect(skills[0]!.instructions).toBe("Project steps");
    expect(skills[0]!.folder).toBe(join(cwd, ".nimbus", "skills", "review"));
  });

  it("lists only skills the model may use, and only when load_skill exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-skills-"));
    await addSkill(cwd, "review", skillFile("review", "Review the staged changes", "Steps"));
    await addSkill(
      cwd,
      "deploy",
      skillFile("deploy", "Deploy", "Run", "disable-model-invocation: true\n"),
    );
    const skills = loadSkills(cwd, cwd);
    const section = skillsSection(skills);
    expect(section).toContain("- review: Review the staged changes");
    expect(section).toContain("- create-skill: Create a new Nimbus skill");
    expect(section).not.toContain("deploy");
    expect(buildSystemPrompt(env, ["load_skill"], { skills })).toContain("\n\nSkills:\n");
    expect(buildSystemPrompt(env, ["read_file"], { skills })).not.toContain("Skills:");
    expect(skillsSection([])).toBe("");
  });

  it("cuts long descriptions in the list", () => {
    const skill: Skill = {
      name: "long",
      description: "word ".repeat(80).trim(),
      instructions: "x",
      folder: null,
      source: "personal",
      modelCanUse: true,
    };
    const line = skillsSection([skill]).split("\n").at(-1)!;
    expect(line.length).toBeLessThanOrEqual("- long: ".length + 200);
    expect(line.endsWith("...")).toBe(true);
  });

  it("loads a skill with its folder, and names the real ones on a wrong name", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-skills-"));
    await addSkill(cwd, "review", skillFile("review", "Review", "Check every file."));
    const skills = loadSkills(cwd, cwd);
    const ctx = ctxWith(cwd, skills);
    const loaded = await loadSkillTool.execute(JSON.stringify({ name: "review" }), ctx);
    expect(loaded.output).toBe(
      `Skill "review" loaded. Its folder is ${join(cwd, ".nimbus", "skills", "review")}.\nIf the instructions mention other files, they are in that folder: read them with read_file\nwhen the instructions say to.\n\nCheck every file.`,
    );
    const builtIn = await loadSkillTool.execute(JSON.stringify({ name: "create-skill" }), ctx);
    expect(builtIn.output.startsWith('Skill "create-skill" loaded (built into Nimbus).\n\n')).toBe(
      true,
    );
    const wrong = await loadSkillTool.execute(JSON.stringify({ name: "reveiw" }), ctx);
    expect(wrong.isError).toBe(true);
    expect(wrong.output).toBe(
      'No skill is named "reveiw". The skills you can load are: review, create-skill. Use one of these names exactly, or continue without a skill.',
    );
  });

  it("lets read_file open files in a personal skill's folder", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-skills-proj-"));
    const home = await mkdtemp(join(tmpdir(), "nimbus-skills-home-"));
    await addSkill(home, "review", skillFile("review", "Review", "Read checklist.md"));
    await writeFile(join(home, ".nimbus", "skills", "review", "checklist.md"), "1. tests\n");
    const file = join(home, ".nimbus", "skills", "review", "checklist.md");
    const args = JSON.stringify({ path: file, offset: null, limit: null });
    const denied = await readFileTool.execute(args, ctxWith(cwd, []));
    expect(denied.isError).toBe(true);
    const read = await readFileTool.execute(args, ctxWith(cwd, loadSkills(cwd, home)));
    expect(read.isError).toBeFalsy();
    expect(read.output).toContain("1. tests");
  });

  it("builds the /name request with $ARGUMENTS, and reads it back for the screen", () => {
    const base: Skill = {
      name: "review",
      description: "Review",
      instructions: "Review $ARGUMENTS carefully.",
      folder: "/s/review",
      source: "project",
      modelCanUse: true,
    };
    const replaced = skillRequest(base, "the auth files");
    expect(replaced).toBe(
      'The user ran the skill "review" by typing /review. Follow these instructions for this request:\n\nReview the auth files carefully.',
    );
    expect(parseSkillRequest(replaced)).toBe("/review");
    const plain = skillRequest({ ...base, instructions: "Review everything." }, "auth only");
    expect(plain.endsWith("\n\nThe user added: auth only")).toBe(true);
    expect(parseSkillRequest(plain)).toBe("/review auth only");
    const builtIn = skillRequest(
      { ...base, name: "create-skill", source: "built-in", instructions: "Write $ARGUMENTS here" },
      "a review skill",
    );
    expect(builtIn).toContain("Write $ARGUMENTS here\n\nThe user added: a review skill");
    expect(parseSkillRequest("just a message")).toBeNull();
  });

  it("writes and edits personal skills outside the project, and nothing else outside", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-skills-proj-"));
    // Home reached through a link, like macOS /var and Windows short names
    const real = await mkdtemp(join(tmpdir(), "nimbus-skills-home-"));
    const home = `${real}-link`;
    await symlink(real, home, "junction");
    const skillsDir = join(home, ".nimbus", "skills");
    const ctx = { ...ctxWith(cwd, []), skillsDir };
    const file = join(skillsDir, "say-hi", "SKILL.md");
    const write = (path: string) =>
      writeFileTool.execute(
        JSON.stringify({ path, content: skillFile("say-hi", "Hi", "Say hi") }),
        ctx,
      );
    const made = await write(file);
    expect(made.isError).toBeFalsy();
    expect(loadSkills(cwd, home)[0]!.name).toBe("say-hi");
    await readFileTool.execute(JSON.stringify({ path: file, offset: null, limit: null }), ctx);
    const edited = await editTool.execute(
      JSON.stringify({
        path: file,
        old_string: "Say hi",
        new_string: "Say hello",
        replace_all: null,
      }),
      ctx,
    );
    expect(edited.isError).toBeFalsy();
    const outside = await write(join(home, "other.md"));
    expect(outside.isError).toBe(true);
    expect(outside.output).toContain("outside the working directory");
  });
});
