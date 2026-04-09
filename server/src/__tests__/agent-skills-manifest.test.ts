import { describe, expect, it } from "vitest";
import { buildSkillsManifest } from "../services/agent-skills-manifest.js";

describe("buildSkillsManifest", () => {
  it("returns null when no skills are provided", () => {
    expect(buildSkillsManifest([])).toBeNull();
  });

  it("includes name, key, description, and body excerpt for each skill", () => {
    const manifest = buildSkillsManifest([
      {
        key: "foo/bar/copywriting",
        name: "copywriting",
        description: "Write marketing copy",
        markdown: "---\nname: copywriting\n---\n# Copywriting playbook\n\nFocus on benefit over feature.",
      },
    ]);
    expect(manifest).not.toBeNull();
    expect(manifest).toContain("# Available skills");
    expect(manifest).toContain("## copywriting");
    expect(manifest).toContain("_foo/bar/copywriting_");
    expect(manifest).toContain("Write marketing copy");
    expect(manifest).toContain("# Copywriting playbook");
    expect(manifest).toContain("Focus on benefit over feature.");
    // Frontmatter should be stripped.
    expect(manifest).not.toContain("name: copywriting\n---");
  });

  it("truncates skills longer than the per-skill budget", () => {
    const longBody = "This is a very long paragraph. ".repeat(100);
    const manifest = buildSkillsManifest(
      [
        {
          key: "k/long",
          name: "long",
          description: "d",
          markdown: `# Heading\n\n${longBody}`,
        },
      ],
      { bodyBudgetPerSkill: 200, totalBudget: 10_000 },
    );
    expect(manifest).not.toBeNull();
    expect(manifest!.length).toBeLessThan(2000);
    expect(manifest).toContain("## long");
  });

  it("omits bodies for skills that exceed the total context budget", () => {
    const body = "x".repeat(1500);
    const skills = Array.from({ length: 10 }, (_, i) => ({
      key: `k/skill-${i}`,
      name: `skill-${i}`,
      description: `desc ${i}`,
      markdown: `# skill-${i}\n\n${body}`,
    }));
    const manifest = buildSkillsManifest(skills, {
      bodyBudgetPerSkill: 1200,
      totalBudget: 4000,
    });
    expect(manifest).not.toBeNull();
    expect(manifest).toContain("(Skill body omitted to stay within context budget");
    // Every skill must still be listed by name so the agent knows it exists.
    for (let i = 0; i < 10; i++) {
      expect(manifest).toContain(`## skill-${i}`);
    }
  });

  it("handles skills with no description gracefully", () => {
    const manifest = buildSkillsManifest([
      {
        key: "k/none",
        name: "none",
        description: null,
        markdown: "body",
      },
    ]);
    expect(manifest).toContain("(no description)");
  });
});
