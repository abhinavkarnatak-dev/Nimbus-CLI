import type { Skill } from "@nimbus/harness";

const WHERE = {
  project: "project skill",
  personal: "personal skill",
  "built-in": "built into Nimbus",
};

// The /skills list
export function skillsReport(skills: readonly Skill[]): string[] {
  const lines = ["Skills (type /name to run one):"];
  for (const skill of skills) {
    const who = skill.modelCanUse ? "Nimbus can also use it on its own" : "only you can run it";
    const about =
      skill.description.length > 90
        ? `${skill.description.slice(0, 87).trimEnd()}...`
        : skill.description;
    lines.push(`/${skill.name}  ${about}`, `   ${WHERE[skill.source]}, ${who}`);
  }
  if (!skills.some((skill) => skill.source !== "built-in")) {
    lines.push("Make your own with /create-skill, or ask Nimbus to make one.");
  }
  lines.push("New skills show up after /clear or in your next session.");
  return lines;
}
