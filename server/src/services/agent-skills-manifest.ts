// Builds a compact "skills manifest" string that lists the skills an agent
// has declared (via adapter_config.paperclipSkillSync.desiredSkills) together
// with each skill's description and a short excerpt of its SKILL.md body.
//
// The manifest is injected into the adapter context as
// `paperclipSkillsManifest` and prepended to the expertise preamble by the
// gemma-local adapter. This lets agents *know* which capabilities are
// available to them without blowing the context window on full markdown
// (some bundled skills are 30k+ chars).

const DEFAULT_BODY_BUDGET_PER_SKILL = 900;
const DEFAULT_TOTAL_BUDGET = 16_000;

type SkillRow = {
  key: string;
  name: string;
  description: string | null;
  markdown: string;
};

// Strip YAML frontmatter ("---\n...\n---") and common leading whitespace so
// the excerpt starts with the actual skill body (usually a heading + purpose
// statement).
function stripFrontmatterAndLead(markdown: string): string {
  const trimmed = markdown.trimStart();
  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end !== -1) {
      return trimmed.slice(end + 4).trimStart();
    }
  }
  return trimmed;
}

// Collapse long markdown into a single short excerpt suitable for the
// manifest: drop frontmatter, truncate at the character budget, and stop
// at a paragraph boundary if we find one within the last 150 chars.
function buildSkillExcerpt(markdown: string, maxChars: number): string {
  const body = stripFrontmatterAndLead(markdown);
  if (body.length <= maxChars) return body.trim();

  const clipped = body.slice(0, maxChars);
  const lastBreak = clipped.lastIndexOf("\n\n");
  if (lastBreak > maxChars - 200) {
    return clipped.slice(0, lastBreak).trim() + "\n\n…";
  }
  return clipped.trim() + "…";
}

export type BuildSkillsManifestOptions = {
  bodyBudgetPerSkill?: number;
  totalBudget?: number;
};

export function buildSkillsManifest(
  skills: SkillRow[],
  options: BuildSkillsManifestOptions = {},
): string | null {
  if (skills.length === 0) return null;

  const perSkill = options.bodyBudgetPerSkill ?? DEFAULT_BODY_BUDGET_PER_SKILL;
  const total = options.totalBudget ?? DEFAULT_TOTAL_BUDGET;

  const header = [
    "# Available skills (company library)",
    "",
    "You have access to the following specialist skills loaded by your operator. Each entry includes the skill's purpose and a short excerpt from its playbook. When you take on work that matches a skill's domain, apply its frameworks explicitly and cite the skill by name in your output so the operator can audit which skills drove the deliverable.",
    "",
  ].join("\n");

  const sections: string[] = [];
  let used = header.length;

  for (const skill of skills) {
    const description = (skill.description ?? "").trim();
    const excerpt = buildSkillExcerpt(skill.markdown, perSkill);
    const section = [
      `## ${skill.name}`,
      `_${skill.key}_`,
      "",
      description.length > 0 ? description : "(no description)",
      "",
      excerpt,
    ].join("\n");

    if (used + section.length + 4 > total) {
      sections.push(
        `## ${skill.name}\n_${skill.key}_\n\n${description.length > 0 ? description : "(no description)"}\n\n(Skill body omitted to stay within context budget — load on demand if needed.)`,
      );
      used += 200;
      continue;
    }

    sections.push(section);
    used += section.length + 4;
  }

  return [header, sections.join("\n\n")].join("\n");
}
