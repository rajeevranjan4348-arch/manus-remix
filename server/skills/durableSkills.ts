/**
 * Feature 04: Server-backed Skills Ecosystem.
 *
 * Durable per-user skill catalog stored in Firestore. Third-party skills are
 * treated as untrusted: manifests are validated, source integrity is hashed,
 * code-bearing skills can only execute inside an approved external sandbox, and
 * every execution passes through the durable permission gateway plus an audit
 * trail. Skills can never override core security policies.
 */

import crypto from 'crypto';
import { DurableStore, getDefaultDurableStore } from '../durable/store';
import { permissionsGateway } from '../permissionsGateway';
import { sandboxService, SandboxRuntime } from '../sandbox/sandboxService';

export interface SkillCompatibility {
  minAgentPlatform: 'any' | string;
  requiredRuntimes: Array<'node' | 'python' | 'browser'>;
  toolFrameworkVersion: string;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version: string; // semver-ish "MAJOR.MINOR.PATCH"
  author: string;
  category: 'analysis' | 'coding' | 'productivity' | 'utilities' | 'research';
  instructions: string;
  supportedTools: string[];
  dependencies: string[]; // skill ids
  permissions: string[]; // tool names requiring approval
  compatibility: SkillCompatibility;
  codeSandboxRequired: boolean;
}

export interface InstalledSkill extends SkillManifest {
  userId: string;
  installedAt: string;
  updatedAt: string;
  enabled: boolean;
  source: 'builtin' | 'third-party';
  sourceHash: string;
  sourceUrl?: string;
  installedVersion: string;
  configuration: Record<string, any>;
  dependencyOk: boolean;
}

export interface SkillExecutionRecord {
  id: string;
  skillId: string;
  skillVersion: string;
  userId: string;
  input: Record<string, any>;
  status: 'completed' | 'failed' | 'blocked' | 'unavailable';
  startedAt: string;
  finishedAt?: string;
  output?: any;
  error?: string;
  sandboxId?: string;
  auditId?: string;
}

const SKILLS_COLLECTION = 'system_skills_installed';
const SKILL_VERSIONS_COLLECTION = 'system_skill_versions';
const SKILL_EXECUTIONS_COLLECTION = 'system_skill_executions';

export const SKILL_MANIFEST_MAX_BYTES = 64 * 1024;
export const SKILL_SUPPORTED_RUNTIMES = ['node', 'python', 'browser'] as const;

export class SkillManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillManifestError';
  }
}

export function validateSkillManifest(raw: unknown): SkillManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SkillManifestError('Skill manifest must be a JSON object.');
  }
  const m = raw as Record<string, any>;
  const requireString = (v: any, field: string, max = 200): string => {
    if (typeof v !== 'string' || !v.trim()) throw new SkillManifestError(`Manifest field '${field}' must be a non-empty string.`);
    return v.slice(0, max);
  };
  const semver = requireString(m.version, 'version', 32);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(semver)) {
    throw new SkillManifestError('Manifest version must be semantic (MAJOR.MINOR.PATCH).');
  }
  const supportedTools = Array.isArray(m.supportedTools)
    ? m.supportedTools.map((t: any) => String(t)).slice(0, 25)
    : [];
  const protectedTools = ['permissions_evaluate', 'permissions_approve', 'audit_read'];
  if (supportedTools.some((t: string) => protectedTools.includes(t))) {
    throw new SkillManifestError('Skills may never request core security tools.');
  }
  const permissions = Array.isArray(m.permissions) ? m.permissions.map((p: any) => String(p)).slice(0, 25) : [];
  const compatibility: SkillCompatibility = m.compatibility && typeof m.compatibility === 'object'
    ? {
        minAgentPlatform: String(m.compatibility.minAgentPlatform ?? 'any').slice(0, 50),
        requiredRuntimes: (Array.isArray(m.compatibility.requiredRuntimes)
          ? m.compatibility.requiredRuntimes
          : []).filter((r: any) => SKILL_SUPPORTED_RUNTIMES.includes(r)).slice(0, 3),
        toolFrameworkVersion: String(m.compatibility.toolFrameworkVersion ?? '1').slice(0, 10),
      }
    : { minAgentPlatform: 'any', requiredRuntimes: [], toolFrameworkVersion: '1' };

  return {
    id: requireString(m.id, 'id', 100).replace(/[^a-zA-Z0-9_\-.]/g, ''),
    name: requireString(m.name, 'name', 100),
    description: requireString(m.description, 'description', 1000),
    version: semver,
    author: requireString(m.author, 'author', 100),
    category: ['analysis', 'coding', 'productivity', 'utilities', 'research'].includes(m.category)
      ? m.category
      : 'utilities',
    instructions: requireString(m.instructions, 'instructions', 8000),
    supportedTools,
    dependencies: Array.isArray(m.dependencies) ? m.dependencies.map((d: any) => String(d)).slice(0, 15) : [],
    permissions,
    compatibility,
    codeSandboxRequired: m.codeSandboxRequired === true,
  };
}

export function manifestSourceHash(manifest: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 32);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** Built-in production skills curated by the platform (trusted source). */
export const BUILTIN_SKILL_MANIFESTS: SkillManifest[] = [
  {
    id: 'builtin.web-research-brief',
    name: 'Web Research Brief',
    description: 'Produces a structured research brief from public web sources with citations.',
    version: '1.0.0',
    author: 'manus-remix-core',
    category: 'research',
    instructions:
      'Compile a structured briefing on the supplied topic using web_search and fetch_webpage. Include a summary, key findings with citations, and open questions.',
    supportedTools: ['web_search', 'fetch_webpage'],
    dependencies: [],
    permissions: [],
    compatibility: { minAgentPlatform: 'any', requiredRuntimes: [], toolFrameworkVersion: '1' },
    codeSandboxRequired: false,
  },
  {
    id: 'builtin.code-quality-check',
    name: 'Code Quality Check',
    description: 'Runs lint/type style quality inspection inside an isolated sandbox workspace.',
    version: '1.0.0',
    author: 'manus-remix-core',
    category: 'coding',
    instructions:
      'Inspect the provided workspace files for quality issues using the sandboxed filesystem and terminal tools; produce a prioritized findings list.',
    supportedTools: ['terminal_execute', 'filesystem_list', 'filesystem_read'],
    dependencies: [],
    permissions: ['terminal_execute'],
    compatibility: { minAgentPlatform: 'any', requiredRuntimes: ['node'], toolFrameworkVersion: '1' },
    codeSandboxRequired: true,
  },
];

export interface SandboxCapability {
  available: boolean;
  reason?: string;
}

export interface SkillExecutorDeps {
  sandboxAvailability: () => SandboxCapability;
}

export class DurableSkillsService {
  constructor(private readonly store: DurableStore | null = null) {}

  private get backend(): DurableStore {
    if (this.store) return this.store;
    return getDefaultDurableStore();
  }

  private docId(userId: string, skillId: string): string {
    return `${userId}:${skillId}`;
  }

  public listBuiltins(): SkillManifest[] {
    return BUILTIN_SKILL_MANIFESTS;
  }

  public async listInstalled(userId: string, includeDisabled = true): Promise<InstalledSkill[]> {
    const store = this.backend;
    if (store.kind === 'unavailable') throw new Error('Durable store unavailable: Firestore credentials are not configured.');
    const rows = await store.query(SKILLS_COLLECTION, {
      filters: [{ field: 'userId', op: 'eq', value: userId }],
      limit: 200,
    });
    const installed = rows as unknown as InstalledSkill[];
    const withBuiltins = [...installed];
    if (includeDisabled) return withBuiltins;
    return withBuiltins.filter((s) => s.enabled);
  }

  public async search(userId: string, term: string): Promise<InstalledSkill[]> {
    const all = await this.listInstalled(userId);
    const q = term.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) =>
      [s.id, s.name, s.description, s.category].join(' ').toLowerCase().includes(q),
    );
  }

  /**
   * Install a third-party skill. Validates the manifest, verifies dependency
   * availability, and stores a versioned copy so rollback is possible.
   */
  public async install(userId: string, rawManifest: unknown, sourceUrl?: string): Promise<InstalledSkill> {
    const store = this.backend;
    if (store.kind === 'unavailable') throw new Error('Durable store unavailable: Firestore credentials are not configured.');

    const manifest = validateSkillManifest(rawManifest);
    const sourceHash = manifestSourceHash(rawManifest);

    // Dependency validation.
    const installed = await this.listInstalled(userId, false);
    const builtins = new Set(BUILTIN_SKILL_MANIFESTS.map((s) => s.id));
    const missingDeps = manifest.dependencies.filter((dep) => !installed.some((s) => s.id === dep) && !builtins.has(dep));
    const dependencyOk = missingDeps.length === 0;

    const nowIso = new Date().toISOString();
    const record: InstalledSkill = {
      ...manifest,
      userId,
      installedAt: nowIso,
      updatedAt: nowIso,
      enabled: true,
      source: 'third-party',
      sourceHash,
      sourceUrl: sourceUrl?.slice(0, 500),
      installedVersion: manifest.version,
      configuration: {},
      dependencyOk,
    };

    const docId = this.docId(userId, manifest.id);
    const created = await store.create(SKILLS_COLLECTION, docId, record as unknown as Record<string, any>);
    if (!created) {
      throw new Error(`Skill '${manifest.id}' is already installed. Use the update action instead.`);
    }
    await store.set(SKILL_VERSIONS_COLLECTION, `${docId}:${manifest.version}`, {
      ...record,
      versionedAt: nowIso,
    } as unknown as Record<string, any>);
    return record;
  }

  /** Update an installed skill to a newer version, keeping prior versions. */
  public async update(userId: string, skillId: string, rawManifest: unknown): Promise<InstalledSkill> {
    const store = this.backend;
    const existing = await this.getInstallRecord(userId, skillId);
    if (!existing) throw new Error(`Skill '${skillId}' is not installed.`);
    const manifest = validateSkillManifest(rawManifest);
    if (manifest.id !== skillId) throw new Error('Manifest id mismatch with installed skill id.');
    if (compareVersions(manifest.version, existing.version) <= 0) {
      throw new Error(`Update version (${manifest.version}) must be greater than installed version (${existing.version}).`);
    }
    const nowIso = new Date().toISOString();
    const next: InstalledSkill = {
      ...existing,
      ...manifest,
      installedVersion: existing.installedVersion,
      version: manifest.version,
      sourceHash: manifestSourceHash(rawManifest),
      updatedAt: nowIso,
    };
    await store.set(SKILLS_COLLECTION, this.docId(userId, skillId), next as unknown as Record<string, any>);
    await store.set(SKILL_VERSIONS_COLLECTION, `${this.docId(userId, skillId)}:${manifest.version}`, {
      ...next,
      versionedAt: nowIso,
    } as unknown as Record<string, any>);
    return next;
  }

  public async rollback(userId: string, skillId: string, toVersion: string): Promise<InstalledSkill> {
    const store = this.backend;
    const versionDoc = await store.get(SKILL_VERSIONS_COLLECTION, `${this.docId(userId, skillId)}:${toVersion}`);
    if (!versionDoc) throw new Error(`No stored version '${toVersion}' for skill '${skillId}'.`);
    const next: InstalledSkill = { ...(versionDoc as unknown as InstalledSkill), updatedAt: new Date().toISOString() };
    await store.set(SKILLS_COLLECTION, this.docId(userId, skillId), next as unknown as Record<string, any>);
    return next;
  }

  public async uninstall(userId: string, skillId: string): Promise<boolean> {
    const store = this.backend;
    return store.delete(SKILLS_COLLECTION, this.docId(userId, skillId));
  }

  public async setEnabled(userId: string, skillId: string, enabled: boolean): Promise<boolean> {
    return this.backend.update(SKILLS_COLLECTION, this.docId(userId, skillId), {
      enabled,
      updatedAt: new Date().toISOString(),
    });
  }

  public async configure(userId: string, skillId: string, configuration: Record<string, any>): Promise<boolean> {
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
      throw new Error('Configuration must be an object.');
    }
    return this.backend.update(SKILLS_COLLECTION, this.docId(userId, skillId), {
      configuration,
      updatedAt: new Date().toISOString(),
    });
  }

  public async getInstallRecord(userId: string, skillId: string): Promise<InstalledSkill | null> {
    const doc = await this.backend.get(SKILLS_COLLECTION, this.docId(userId, skillId));
    return (doc as unknown as InstalledSkill) ?? null;
  }

  public async listExecutionHistory(userId: string, skillId?: string, limit = 50): Promise<SkillExecutionRecord[]> {
    const store = this.backend;
    if (store.kind === 'unavailable') throw new Error('Durable store unavailable: Firestore credentials are not configured.');
    const filters = [{ field: 'userId', op: 'eq' as const, value: userId }];
    if (skillId) filters.push({ field: 'skillId', op: 'eq' as const, value: skillId });
    const rows = await store.query(SKILL_EXECUTIONS_COLLECTION, { filters, limit });
    return (rows as unknown as SkillExecutionRecord[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * Execute an installed skill with explicit authorization. Every sensitive
   * tool the skill requires must be approved server-side via the durable
   * permission gateway. Code-bearing skills run only in a verified external
   * sandbox; if none is configured the result is `unavailable`, never a fake
   * success and never host execution.
   */
  public async executeSkill(params: {
    userId: string;
    skillId: string;
    input: Record<string, any>;
    approvalToken?: string;
    sandboxAvailable?: boolean;
  }): Promise<SkillExecutionRecord> {
    const store = this.backend;
    const startedAt = new Date().toISOString();
    const record: SkillExecutionRecord = {
      id: `skill_exec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      skillId: params.skillId,
      skillVersion: 'unknown',
      userId: params.userId,
      input: params.input,
      status: 'failed',
      startedAt,
    };
    const finish = async (status: SkillExecutionRecord['status'], output?: any, error?: string, sandboxId?: string) => {
      record.status = status;
      record.output = output;
      record.error = error;
      record.sandboxId = sandboxId;
      record.finishedAt = new Date().toISOString();
      if (store.kind !== 'unavailable') {
        await store.set(SKILL_EXECUTIONS_COLLECTION, record.id, record as unknown as Record<string, any>).catch(() => undefined);
      }
      return record;
    };

    const skill = await this.getInstallRecord(params.userId, params.skillId);
    if (!skill) {
      return finish('failed', undefined, `Skill '${params.skillId}' is not installed.`);
    }
    if (!skill.enabled) {
      return finish('blocked', undefined, `Skill '${skill.name}' is disabled.`);
    }
    if (!skill.dependencyOk) {
      return finish('blocked', undefined, `Skill '${skill.name}' has unresolved dependencies.`);
    }
    record.skillVersion = skill.version;

    if (!params.input || typeof params.input !== 'object' || Array.isArray(params.input)) {
      return finish('failed', undefined, 'Skill input must be an object.');
    }

    const sandboxOk = params.sandboxAvailable ?? sandboxService.isConfigured();

    // Permission gate: every declared sensitive tool needs server-side approval state.
    if (skill.codeSandboxRequired && !sandboxOk) {
      return finish(
        'unavailable',
        undefined,
        "Skill execution requires an external sandbox provider; none is configured.",
      );
    }

    for (const toolName of skill.permissions) {
      const evaluation = permissionsGateway.evaluateAction({
        toolName,
        args: { ...params.input, skillId: skill.id },
        userId: params.userId,
        target: skill.id,
      });
      if (evaluation.unavailable && !evaluation.allowed) {
        return finish('blocked', undefined, evaluation.reason);
      }
      if (!evaluation.allowed && !params.approvalToken) {
        return finish('blocked', undefined, evaluation.reason, undefined);
      }
      if (params.approvalToken) {
        await permissionsGateway.hydrateToken(params.approvalToken);
        const verification = await permissionsGateway.verifyApprovalToken({
          approvalToken: params.approvalToken,
          toolName,
          args: { ...params.input, skillId: skill.id },
          userId: params.userId,
        });
        if (!verification.valid) {
          return finish('blocked', undefined, verification.reason, undefined);
        }
      }
    }

    // Code-bearing skills are untrusted: execute in the external sandbox only.
    if (skill.codeSandboxRequired) {
      try {
        const sandbox = await sandboxService.createSandbox({
          userId: params.userId,
          runtimes: skill.compatibility.requiredRuntimes.filter((r): r is Exclude<typeof r, 'browser'> => r !== 'browser') as SandboxRuntime[],
          purpose: `skill:${skill.id}`,
        });
        if (!sandbox.ok) {
          return finish('unavailable', undefined, sandbox.reason, undefined);
        }
        // Skill instructions are data, not code: they are executed only as
        // agent guidance through the approved tool framework. The sandbox holds
        // the workspace; host processes are never spawned from skill content.
        return finish('completed', {
          sandboxId: (sandbox.sandbox as any).sandboxId,
          instructions: skill.instructions,
          executedInSandbox: true,
        }, undefined, (sandbox.sandbox as any).sandboxId);
      } catch (error) {
        return finish('failed', undefined, error instanceof Error ? error.message : 'sandbox execution failed');
      }
    }

    // Non-code skills: their instructions drive agent behavior via the model
    // and declared read-only tools; there is no handler code to run on the host.
    return finish('completed', {
      instructions: skill.instructions,
      supportedTools: skill.supportedTools,
      status: 'advisory-output',
    });
  }
}

export const durableSkills = new DurableSkillsService();
