import type { Skill } from "./skills.js";

// Seen by the model when it loads create-skill
const CREATE_SKILL = `You are creating a skill: a folder with a SKILL.md file that Nimbus loads when a task
needs it. Follow these steps.

1. Understand what the skill is for. You need to know what task it handles, when it should
   be used, the steps or rules to follow, and what a good result looks like. If the
   conversation already shows the workflow (the user just did it with you), build the skill
   from that. If something that would change the result is missing, ask the user one short
   question before writing anything.

2. Choose where it goes:
   - Project skill: .nimbus/skills/<name>/SKILL.md inside this project's folder. Use it for
     workflows tied to this codebase: its commands, layout and conventions. It can be shared
     with the team through the repo.
   - Personal skill: ~/.nimbus/skills/<name>/SKILL.md in the user's home folder. Use it for
     the user's own habits that apply in every project.
   If the user did not say which, pick the one that fits and tell them which you chose.

3. Choose the name: lowercase letters, numbers and hyphens, at most 64 characters, short
   and about the task (for example review-changes or release-notes). The folder name and
   the name field must be the same. If a skill with that name already exists in that
   folder, improve it instead of making a second one.

4. Write SKILL.md in this format:

   ---
   name: <name>
   description: <what it does and when to use it>
   ---
   <instructions>

   Add the line disable-model-invocation: true under description only when the skill
   should run just when the user types /<name>: actions with side effects (deploys,
   commits, sending messages) or anything where the user wants to decide the timing.

5. Write the description carefully. It is the only part the model sees before loading the
   skill, so it decides when the skill gets used. Say what the skill does and when to use
   it, with the words a user would type for that task. Example: "Write release notes from
   the commits since the last tag. Use when the user asks for release notes or a
   changelog." Keep it under 200 characters, because longer descriptions are cut.

6. Write the instructions for a model that has never seen this conversation:
   - The steps in order, with the exact commands, file paths and checks.
   - The rules the user cares about, and what to avoid.
   - What the finished result should look like, with a short example when the format
     matters.
   - Write $ARGUMENTS where the text the user types after /<name> should go.
   - Keep it to one kind of task and under about 200 lines. Put long reference material
     (checklists, templates, examples) in separate files in the same folder, and say in
     SKILL.md when to read each one.
   - Never put keys, tokens or passwords in a skill.

7. Write the files with write_file. Then tell the user where the skill is, that it is
   available from their next session or after /clear, and how to use it: by typing
   /<name>, or (unless it has disable-model-invocation: true) by asking for the task in
   their own words.`;

export const BUILT_IN_SKILLS: readonly Skill[] = [
  {
    name: "create-skill",
    description:
      "Create a new Nimbus skill or improve an existing one. Use when the user asks for a skill, a reusable workflow or saved instructions.",
    instructions: CREATE_SKILL,
    folder: null,
    source: "built-in",
    modelCanUse: true,
  },
];
