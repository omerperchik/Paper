import fs from "node:fs/promises";

const MARKETING_AGENT_BUNDLE = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md"] as const;

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  cmo: MARKETING_AGENT_BUNDLE,
  "content-strategist": MARKETING_AGENT_BUNDLE,
  "seo-specialist": MARKETING_AGENT_BUNDLE,
  "paid-acquisition": MARKETING_AGENT_BUNDLE,
  "social-media": MARKETING_AGENT_BUNDLE,
  "email-marketing": MARKETING_AGENT_BUNDLE,
  "analytics-lead": MARKETING_AGENT_BUNDLE,
  "community-manager": MARKETING_AGENT_BUNDLE,
  "conversion-optimizer": MARKETING_AGENT_BUNDLE,
  "meta-optimizer": MARKETING_AGENT_BUNDLE,
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

const MARKETING_ROLES = new Set<string>([
  "cmo",
  "content-strategist",
  "seo-specialist",
  "paid-acquisition",
  "social-media",
  "email-marketing",
  "analytics-lead",
  "community-manager",
  "conversion-optimizer",
  "meta-optimizer",
]);

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  if (role === "ceo") return "ceo";
  if (MARKETING_ROLES.has(role)) return role as DefaultAgentBundleRole;
  return "default";
}

export function getAvailableMarketingRoles(): string[] {
  return Array.from(MARKETING_ROLES);
}
