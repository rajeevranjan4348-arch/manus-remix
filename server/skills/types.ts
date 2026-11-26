/**
 * Server-backed skills ecosystem types (Feature 04).
 *
 * Skills are durable records with full version history. Third-party skills are
 * treated as untrusted: manifests are strictly validated and code-bearing
 * skills may only run inside the Feature 06 sandbox, never on the host.
 */

export type SkillRuntime = 'prompt' | 'sandbox';

export interface SkillManifest {
  id: string;            // slug: [a-z0-9][a-z0-9-]{2,63}
  name: string;
  description: string;
  version: string;       // MAJOR.MINOR.PATCH
  author: string;
  instructions: string;  // agent instructions (never executed as code)
  supportedTools: string[];
  dependencies: string[]; // other skill ids that must be installed
  permissions: string[];  // gateway tool names that will require approval when the skill runs
  compat: { runtime: SkillRuntime; minAppVersion?: string };
  entrypoint?: { file: string; command: string } | null;
  files?: Array<{ path: string; content: string }>;
}

export interface SkillVersionEntry {
  version: string;
  manifest: SkillManifest;
  updatedAt: string;
}

export type SkillStatus = 'installed' | 'removed';

export interface SkillInstallState {
  skillId: string;
  userId: string;
  status: SkillStatus;
  enabled: boolean;
  installedVersion: string;
  activeManifest: SkillManifest;
  versionHistory: SkillVersionEntry[];
  source: 'builtin' | 'third-party';
  installedAt: string;
  updatedAt: string;
}

export interface SkillExecutionRecord {
  executionId: string;
  skillId: string;
  userId: string;
  version: string;
  status: 'completed' | 'failed' | 'refused';
  reason: string;
  result?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durable: boolean;
}

export const SKILL_HARD_LIMITS = {
  maxSkillsPerUser: 50,
  maxVersionHistory: 10,
  maxInstructionsChars: 20000,
  maxDescriptionChars: 1000,
  maxFiles: 20,
  maxFileBytes: 100 * 1024,
  maxToolsListed: 25,
} as const;
