import { z } from "zod";
import { defineTool } from "./types.js";

const schema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("The skill's name, exactly as written in the Skills list."),
});

export const loadSkillTool = defineTool({
  name: "load_skill",
  description: `Load the full instructions of one skill from the Skills list in your instructions. Call
it when the user's request matches a skill's description, before you start the work, and
follow what it returns for the rest of the task. Pass the skill's name exactly as listed.
A skill only needs to be loaded once per conversation: its instructions stay in the
conversation after that.`,
  schema,
  // Return one skill's instructions
  async run({ name }, ctx) {
    const usable = (ctx.skills ?? []).filter((skill) => skill.modelCanUse);
    const skill = usable.find((entry) => entry.name === name.trim());
    if (!skill) {
      return {
        output: usable.length
          ? `No skill is named "${name}". The skills you can load are: ${usable.map((entry) => entry.name).join(", ")}. Use one of these names exactly, or continue without a skill.`
          : `No skill is named "${name}", and there are no skills you can load in this session. Continue without a skill.`,
        summary: "no such skill",
        isError: true,
      };
    }
    const head = skill.folder
      ? `Skill "${skill.name}" loaded. Its folder is ${skill.folder}.
If the instructions mention other files, they are in that folder: read them with read_file
when the instructions say to.`
      : `Skill "${skill.name}" loaded (built into Nimbus).`;
    return { output: `${head}\n\n${skill.instructions}`, summary: "loaded" };
  },
});
