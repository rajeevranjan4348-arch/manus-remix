/**
 * Feature 04 — Server-Backed Skills Ecosystem Engine.
 *
 * Implements a durable, secure, versioned skills platform:
 * - Server-backed built-in catalog + user-installed skills persisted via DurableCollectionStore.
 * - Search & discovery, install/update/rollback versions, enable/disable, per-user config, remove.
 * - SemVer validation, dependency & circular-dependency checking, platform compatibility checks,
 *   SHA-256 integrity hash verification, and strict prompt-injection / policy-override blocking.
 * - Explicit Feature 02 permissions approval for untrusted third-party installs and sandbox execution.
 * - ZERO arbitrary code execution on the Netlify host: code-bearing skills execute strictly
 *   inside Feature 06 isolated sandboxes via SandboxExecutionEngine.
 * - Intelligent task-to-skill selection & durable execution history.
 */

import crypto from 'node:crypto';
import {
  defaultCollectionStore,
  type DurableCollectionStore,
} from '../infrastructure/durableCollectionStore';
import {
  permissionsGateway,
  type PermissionChallenge,
  type PermissionsGatewayService,
} from '../permissionsGateway';
import {
  defaultDurableStore,
  type DurableExecutionStore,
  type DurableRequestContext,
} from '../sandbox/durableStore';
import {
  defaultSandboxEngine,
  type SandboxExecutionEngine,
} from '../sandbox/sandboxEngine';

export type SkillExecutionType = 'declarative' | 'tool_workflow' | 'sandbox_code';
export type SkillTrustTier = 'verified_builtin' | 'third_party';

export interface SkillDependencySpec {
  skillId: string;
  minVersion?: string;
}

export interface SkillManifestInput {
  id: string;
  name: string;
  description: string;
  version: string;
  instructions: string;
  supportedTools: string[];
  dependencies?: SkillDependencySpec[];
  permissions?: string[];
  compatibility?: {
    minPlatformVersion?: string;
    maxPlatformVersion?: string;
    runtimes?: string[];
  };
  executionType?: SkillExecutionType;
  sandboxScript?: {
    runtime: 'node' | 'python';
    entryCommand: string;
    files: Record<string, string>;
  };
  tags?: string[];
  integrityHash?: string;
  trustTier?: SkillTrustTier;
}

export interface SkillVersionSnapshot {
  version: string;
  description: string;
  instructions: string;
  supportedTools: string[];
  dependencies: SkillDependencySpec[];
  permissions: string[];
  compatibility?: SkillManifestInput['compatibility'];
  executionType: SkillExecutionType;
  sandboxScript?: SkillManifestInput['sandboxScript'];
  integrityHash: string;
  publishedAt: string;
}

export interface InstalledSkillRecord {
  skillId: string;
  userId: string;
  name: string;
  description: string;
  version: string;
  instructions: string;
  supportedTools: string[];
  dependencies: SkillDependencySpec[];
  permissions: string[];
  compatibility?: SkillManifestInput['compatibility'];
  executionType: SkillExecutionType;
  sandboxScript?: SkillManifestInput['sandboxScript'];
  tags: string[];
  trustTier: SkillTrustTier;
  integrityHash: string;
  enabled: boolean;
  config: Record<string, unknown>;
  versions: SkillVersionSnapshot[];
  installedAt: string;
  updatedAt: string;
}

export interface SkillExecutionRecord {
  executionId: string;
  userId: string;
  skillId: string;
  skillVersion: string;
  executionType: SkillExecutionType;
  status: 'succeeded' | 'failed' | 'denied';
  inputSummary: string;
  output?: unknown;
  sandboxId?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export class SkillsEngineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly challenge?: PermissionChallenge;

  constructor(message: string, code = 'SKILLS_ENGINE_ERROR', statusCode = 400, challenge?: PermissionChallenge) {
    super(message);
    this.name = 'SkillsEngineError';
    this.code = code;
    this.statusCode = statusCode;
    this.challenge = challenge;
  }
}

export const PLATFORM_VERSION = '2.0.0';

const SKILLS_COLLECTION = 'skills';
const SKILL_EXECUTIONS_COLLECTION = 'skill_executions';

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

// Reject malicious instructions attempting to disable core permissions, exfiltrate secrets, or override system policies
const POLICY_OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system|security)\s+(?:instructions|policies|rules)/i,
  /bypass\s+(?:permissions?|auth|authentication|sandbox|security|policy\s+gateway)/i,
  /disable\s+(?:security|audit|permissions?|approval\s+checks?)/i,
  /exfiltrate\s+(?:env|secrets?|api[_\s]?keys?|tokens?|credentials?)/i,
  /printenv|process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN)|\/etc\/shadow/i,
];

export function compareSemver(a: string, b: string): number {
  const ma = a.match(SEMVER_REGEX);
  const mb = b.match(SEMVER_REGEX);
  if (!ma || !mb) return 0;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(ma[i]) - Number(mb[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function computeSkillIntegrityHash(manifest: {
  id: string;
  version: string;
  instructions: string;
  executionType: SkillExecutionType;
  sandboxScript?: SkillManifestInput['sandboxScript'];
}): string {
  const canonical = JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    instructions: manifest.instructions,
    executionType: manifest.executionType,
    sandboxScript: manifest.sandboxScript || null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export const VERIFIED_BUILTIN_CATALOG: SkillManifestInput[] = [
  {
    id: 'deep-research-analyst',
    name: 'Deep Research & Verification Analyst',
    description: 'Synthesizes multi-source verified research briefs with source provenance and explicit confidence caveats.',
    version: '1.2.0',
    instructions:
      'Decompose research questions into verifiable sub-queries, cross-check primary sources, separate confirmed facts from assumptions, and cite exact references.',
    supportedTools: ['web_search', 'fetch_webpage', 'read_memory'],
    dependencies: [],
    permissions: ['web_search', 'fetch_webpage'],
    compatibility: { minPlatformVersion: '1.0.0' },
    executionType: 'declarative',
    tags: ['research', 'analysis', 'citations', 'web'],
    trustTier: 'verified_builtin',
  },
  {
    id: 'sandbox-fullstack-builder',
    name: 'Sandboxed Full-Stack Builder',
    description: 'Scaffolds, edits, builds, and tests web applications inside isolated Feature 06 sandboxes.',
    version: '1.4.0',
    instructions:
      'Create an isolated sandbox workspace, write modular TypeScript/React code, install dependencies cleanly, run tests, and verify preview server readiness.',
    supportedTools: [
      'sandbox_create',
      'filesystem_write',
      'filesystem_edit',
      'terminal_exec',
      'preview_start',
      'preview_status',
    ],
    dependencies: [],
    permissions: ['sandbox_create', 'filesystem_write', 'terminal_exec'],
    compatibility: { minPlatformVersion: '1.5.0', runtimes: ['node', 'vite', 'react'] },
    executionType: 'tool_workflow',
    tags: ['coding', 'sandbox', 'react', 'vite', 'builder'],
    trustTier: 'verified_builtin',
  },
  {
    id: 'security-audit-guardian',
    name: 'Security & Authorization Auditor',
    description: 'Reviews authentication, tenant boundaries, secret handling, injection vectors, and Firestore rules.',
    version: '1.1.0',
    instructions:
      'Inspect backend routes, storage policies, input validation, and secret boundaries. Report concrete findings with severity and remediation steps.',
    supportedTools: ['filesystem_list', 'filesystem_read', 'filesystem_search', 'get_git_status'],
    dependencies: [],
    permissions: ['filesystem_read', 'filesystem_search'],
    compatibility: { minPlatformVersion: '1.0.0' },
    executionType: 'declarative',
    tags: ['security', 'audit', 'review', 'compliance'],
    trustTier: 'verified_builtin',
  },
  {
    id: 'browser-qa-inspector',
    name: 'Real Browser QA Inspector',
    description: 'Navigates live preview URLs in isolated browser sessions to verify rendering, DOM assertions, and console logs.',
    version: '1.0.0',
    instructions:
      'Launch an isolated browser session, navigate to the target preview URL, inspect DOM elements and console errors, capture screenshot evidence, and close the session.',
    supportedTools: [
      'browser_create_session',
      'browser_navigate',
      'browser_extract',
      'browser_console',
      'browser_screenshot',
      'browser_close_session',
    ],
    dependencies: [{ skillId: 'sandbox-fullstack-builder', minVersion: '1.0.0' }],
    permissions: ['browser_create_session', 'browser_navigate', 'browser_screenshot'],
    compatibility: { minPlatformVersion: '1.5.0' },
    executionType: 'tool_workflow',
    tags: ['browser', 'qa', 'testing', 'screenshot'],
    trustTier: 'verified_builtin',
  },
  {
    id: 'scheduled-market-brief',
    name: 'Scheduled Intelligence Briefing',
    description: 'Generates structured recurring intelligence reports designed for scheduled automation tasks.',
    version: '1.0.0',
    instructions:
      'Gather latest updates on the configured topic, highlight material deltas since the previous cycle, and produce a concise executive summary.',
    supportedTools: ['web_search', 'fetch_webpage'],
    dependencies: [{ skillId: 'deep-research-analyst', minVersion: '1.0.0' }],
    permissions: ['web_search'],
    compatibility: { minPlatformVersion: '1.0.0' },
    executionType: 'declarative',
    tags: ['schedule', 'research', 'briefing', 'automation'],
    trustTier: 'verified_builtin',
  },
];

export interface SkillsEngineOptions {
  store?: DurableCollectionStore;
  auditStore?: DurableExecutionStore;
  permissions?: PermissionsGatewayService;
  sandboxEngine?: SandboxExecutionEngine;
}

export class SkillsEcosystemEngine {
  private readonly store: DurableCollectionStore;
  private readonly auditStore: DurableExecutionStore;
  private readonly permissions: PermissionsGatewayService;
  private readonly sandboxEngine: SandboxExecutionEngine;

  constructor(options?: SkillsEngineOptions) {
    this.store = options?.store ?? defaultCollectionStore;
    this.auditStore = options?.auditStore ?? defaultDurableStore;
    this.permissions = options?.permissions ?? permissionsGateway;
    this.sandboxEngine = options?.sandboxEngine ?? defaultSandboxEngine;
  }

  public getCatalog(): Array<SkillManifestInput & { integrityHash: string }> {
    return VERIFIED_BUILTIN_CATALOG.map((item) => ({
      ...item,
      integrityHash: computeSkillIntegrityHash({
        id: item.id,
        version: item.version,
        instructions: item.instructions,
        executionType: item.executionType || 'declarative',
        sandboxScript: item.sandboxScript,
      }),
    }));
  }

  public discoverCatalog(query = ''): Array<SkillManifestInput & { integrityHash: string }> {
    const q = query.trim().toLowerCase();
    const all = this.getCatalog();
    if (!q) return all;
    return all.filter((skill) => {
      const haystack = [
        skill.id,
        skill.name,
        skill.description,
        ...(skill.tags || []),
        ...(skill.supportedTools || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  /**
   * Strict manifest & security validation:
   * - Validates ID, SemVer, platform compatibility, integrity hash, and sandbox script constraints.
   * - Blocks prompt-injection or core-policy-override attempts.
   */
  public validateManifest(manifest: SkillManifestInput): {
    executionType: SkillExecutionType;
    integrityHash: string;
    trustTier: SkillTrustTier;
  } {
    if (!manifest || typeof manifest !== 'object') {
      throw new SkillsEngineError('Skill manifest object is required.', 'INVALID_MANIFEST', 400);
    }
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(manifest.id || '')) {
      throw new SkillsEngineError(
        'Skill id must be 2–64 lowercase alphanumeric characters with hyphens or underscores.',
        'INVALID_SKILL_ID',
        400,
      );
    }
    if (!manifest.name?.trim() || !manifest.description?.trim() || !manifest.instructions?.trim()) {
      throw new SkillsEngineError('Skill name, description, and instructions are required.', 'INVALID_MANIFEST', 400);
    }
    if (!SEMVER_REGEX.test(manifest.version || '')) {
      throw new SkillsEngineError('Skill version must follow SemVer (e.g., 1.0.0).', 'INVALID_VERSION', 400);
    }

    // Platform compatibility check
    if (manifest.compatibility?.minPlatformVersion) {
      if (!SEMVER_REGEX.test(manifest.compatibility.minPlatformVersion)) {
        throw new SkillsEngineError('Invalid compatibility.minPlatformVersion.', 'INVALID_COMPATIBILITY', 400);
      }
      if (compareSemver(PLATFORM_VERSION, manifest.compatibility.minPlatformVersion) < 0) {
        throw new SkillsEngineError(
          `Skill requires platform >= ${manifest.compatibility.minPlatformVersion}, current platform is ${PLATFORM_VERSION}.`,
          'INCOMPATIBLE_PLATFORM',
          400,
        );
      }
    }
    if (manifest.compatibility?.maxPlatformVersion) {
      if (compareSemver(PLATFORM_VERSION, manifest.compatibility.maxPlatformVersion) > 0) {
        throw new SkillsEngineError(
          `Skill supports platform <= ${manifest.compatibility.maxPlatformVersion}, current platform is ${PLATFORM_VERSION}.`,
          'INCOMPATIBLE_PLATFORM',
          400,
        );
      }
    }

    // Block policy-override & secret-exfiltration attempts in instructions or sandbox files
    const inspectTexts = [
      manifest.instructions,
      manifest.description,
      ...(manifest.sandboxScript ? Object.values(manifest.sandboxScript.files) : []),
      manifest.sandboxScript?.entryCommand || '',
    ];
    for (const txt of inspectTexts) {
      for (const pattern of POLICY_OVERRIDE_PATTERNS) {
        if (pattern.test(txt)) {
          throw new SkillsEngineError(
            'Skill manifest rejected: attempted to override core security policies or access restricted secrets.',
            'POLICY_OVERRIDE_BLOCKED',
            403,
          );
        }
      }
    }

    const executionType: SkillExecutionType = manifest.executionType || 'declarative';
    if (executionType === 'sandbox_code') {
      if (
        !manifest.sandboxScript ||
        !manifest.sandboxScript.entryCommand?.trim() ||
        !manifest.sandboxScript.files ||
        Object.keys(manifest.sandboxScript.files).length === 0
      ) {
        throw new SkillsEngineError(
          'Code-bearing skills require sandboxScript.entryCommand and at least one file.',
          'INVALID_SANDBOX_SCRIPT',
          400,
        );
      }
      for (const relPath of Object.keys(manifest.sandboxScript.files)) {
        if (relPath.includes('..') || relPath.startsWith('/')) {
          throw new SkillsEngineError(
            `Invalid sandbox script file path '${relPath}'.`,
            'PATH_TRAVERSAL_BLOCKED',
            403,
          );
        }
      }
    }

    const computedHash = computeSkillIntegrityHash({
      id: manifest.id,
      version: manifest.version,
      instructions: manifest.instructions,
      executionType,
      sandboxScript: manifest.sandboxScript,
    });

    if (manifest.integrityHash && manifest.integrityHash.trim() !== computedHash) {
      throw new SkillsEngineError(
        'Skill integrityHash verification failed (SHA-256 mismatch).',
        'INTEGRITY_MISMATCH',
        403,
      );
    }

    const catalogMatch = VERIFIED_BUILTIN_CATALOG.find(
      (b) =>
        b.id === manifest.id &&
        computeSkillIntegrityHash({
          id: b.id,
          version: b.version,
          instructions: b.instructions,
          executionType: b.executionType || 'declarative',
          sandboxScript: b.sandboxScript,
        }) === computedHash,
    );

    const trustTier: SkillTrustTier = catalogMatch ? 'verified_builtin' : 'third_party';
    return { executionType, integrityHash: computedHash, trustTier };
  }

  /**
   * Validate dependencies exist, satisfy minVersion, and do not create dependency cycles.
   */
  private async validateDependencies(
    ctx: DurableRequestContext,
    skillId: string,
    dependencies: SkillDependencySpec[],
  ): Promise<void> {
    if (!dependencies || dependencies.length === 0) return;

    const installed = await this.listInstalledSkills(ctx);
    const byId = new Map<string, InstalledSkillRecord>(installed.map((s) => [s.skillId, s]));

    for (const dep of dependencies) {
      if (dep.skillId === skillId) {
        throw new SkillsEngineError(`Skill '${skillId}' cannot depend on itself.`, 'CIRCULAR_DEPENDENCY', 400);
      }
      const found = byId.get(dep.skillId);
      if (!found) {
        throw new SkillsEngineError(
          `Missing required skill dependency '${dep.skillId}'. Install it first.`,
          'MISSING_DEPENDENCY',
          400,
        );
      }
      if (dep.minVersion && compareSemver(found.version, dep.minVersion) < 0) {
        throw new SkillsEngineError(
          `Dependency '${dep.skillId}' version ${found.version} does not satisfy minimum ${dep.minVersion}.`,
          'DEPENDENCY_VERSION_MISMATCH',
          400,
        );
      }
      // Check transitive cycle back to skillId
      const visited = new Set<string>();
      const stack = [dep.skillId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const rec = byId.get(current);
        for (const child of rec?.dependencies || []) {
          if (child.skillId === skillId) {
            throw new SkillsEngineError(
              `Circular skill dependency detected: ${skillId} <-> ${dep.skillId}.`,
              'CIRCULAR_DEPENDENCY',
              400,
            );
          }
          stack.push(child.skillId);
        }
      }
    }
  }

  /**
   * Install a verified built-in skill by catalog ID or a custom third-party manifest.
   * Third-party skills require explicit Feature 02 approval ('skill_install_untrusted').
   */
  public async installSkill(
    ctx: DurableRequestContext,
    input: {
      catalogId?: string;
      manifest?: SkillManifestInput;
      config?: Record<string, unknown>;
      approvalToken?: string;
    },
  ): Promise<InstalledSkillRecord> {
    let manifest: SkillManifestInput | undefined = input.manifest;
    if (!manifest && input.catalogId) {
      manifest = VERIFIED_BUILTIN_CATALOG.find((c) => c.id === input.catalogId);
      if (!manifest) {
        throw new SkillsEngineError(`Catalog skill '${input.catalogId}' not found.`, 'SKILL_NOT_FOUND', 404);
      }
    }
    if (!manifest) {
      throw new SkillsEngineError('Either catalogId or manifest is required.', 'INVALID_INSTALL_REQUEST', 400);
    }

    const { executionType, integrityHash, trustTier } = this.validateManifest(manifest);
    const dependencies = manifest.dependencies || [];
    await this.validateDependencies(ctx, manifest.id, dependencies);

    // Third-party skills or code-bearing skills require explicit permission approval
    if (trustTier === 'third_party' || executionType === 'sandbox_code') {
      const evaluation = await this.permissions.evaluateActionDurable(
        {
          toolName: 'skill_install_untrusted',
          args: {
            skillId: manifest.id,
            version: manifest.version,
            integrityHash,
            executionType,
          },
          userId: ctx.userId,
          target: `${manifest.id}@${manifest.version}`,
          approvalToken: input.approvalToken,
        },
        ctx,
        this.auditStore,
      );
      if (!evaluation.allowed) {
        throw new SkillsEngineError(
          evaluation.reason,
          'APPROVAL_REQUIRED',
          403,
          evaluation.challenge,
        );
      }
    }

    const nowIso = new Date().toISOString();
    const snapshot: SkillVersionSnapshot = {
      version: manifest.version,
      description: manifest.description.trim(),
      instructions: manifest.instructions.trim(),
      supportedTools: manifest.supportedTools || [],
      dependencies,
      permissions: manifest.permissions || [],
      compatibility: manifest.compatibility,
      executionType,
      sandboxScript: manifest.sandboxScript,
      integrityHash,
      publishedAt: nowIso,
    };

    const existing = await this.store.get<InstalledSkillRecord>(ctx, SKILLS_COLLECTION, manifest.id);
    const versions = existing
      ? [...existing.versions.filter((v) => v.version !== manifest.version), snapshot]
      : [snapshot];

    const record: InstalledSkillRecord = {
      skillId: manifest.id,
      userId: ctx.userId,
      name: manifest.name.trim(),
      description: snapshot.description,
      version: snapshot.version,
      instructions: snapshot.instructions,
      supportedTools: snapshot.supportedTools,
      dependencies,
      permissions: snapshot.permissions,
      compatibility: snapshot.compatibility,
      executionType,
      sandboxScript: snapshot.sandboxScript,
      tags: manifest.tags || [],
      trustTier,
      integrityHash,
      enabled: existing ? existing.enabled : true,
      config: input.config ?? existing?.config ?? {},
      versions,
      installedAt: existing?.installedAt || nowIso,
      updatedAt: nowIso,
    };

    await this.store.put(ctx, SKILLS_COLLECTION, record.skillId, record);

    await this.permissions.recordSecurityAuditDurable(
      ctx,
      {
        action: existing ? 'skill_update' : 'skill_install',
        category: 'skill_execution',
        resourceId: `${record.skillId}@${record.version}`,
        status: 'succeeded',
        details: { trustTier, executionType, integrityHash },
      },
      this.auditStore,
    );

    return record;
  }

  public async rollbackSkillVersion(
    ctx: DurableRequestContext,
    skillId: string,
    targetVersion: string,
  ): Promise<InstalledSkillRecord> {
    const existing = await this.store.get<InstalledSkillRecord>(ctx, SKILLS_COLLECTION, skillId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new SkillsEngineError(`Installed skill '${skillId}' not found.`, 'SKILL_NOT_FOUND', 404);
    }

    const snapshot = existing.versions.find((v) => v.version === targetVersion);
    if (!snapshot) {
      throw new SkillsEngineError(
        `Version '${targetVersion}' not found in version history for '${skillId}'.`,
        'VERSION_NOT_FOUND',
        404,
      );
    }

    existing.version = snapshot.version;
    existing.description = snapshot.description;
    existing.instructions = snapshot.instructions;
    existing.supportedTools = snapshot.supportedTools;
    existing.dependencies = snapshot.dependencies;
    existing.permissions = snapshot.permissions;
    existing.compatibility = snapshot.compatibility;
    existing.executionType = snapshot.executionType;
    existing.sandboxScript = snapshot.sandboxScript;
    existing.integrityHash = snapshot.integrityHash;
    existing.updatedAt = new Date().toISOString();

    await this.store.put(ctx, SKILLS_COLLECTION, existing.skillId, existing);
    return existing;
  }

  public async toggleSkill(
    ctx: DurableRequestContext,
    skillId: string,
    enabled: boolean,
  ): Promise<InstalledSkillRecord> {
    const existing = await this.store.get<InstalledSkillRecord>(ctx, SKILLS_COLLECTION, skillId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new SkillsEngineError(`Installed skill '${skillId}' not found.`, 'SKILL_NOT_FOUND', 404);
    }
    existing.enabled = enabled;
    existing.updatedAt = new Date().toISOString();
    await this.store.put(ctx, SKILLS_COLLECTION, skillId, existing);
    return existing;
  }

  public async configureSkill(
    ctx: DurableRequestContext,
    skillId: string,
    config: Record<string, unknown>,
  ): Promise<InstalledSkillRecord> {
    const existing = await this.store.get<InstalledSkillRecord>(ctx, SKILLS_COLLECTION, skillId);
    if (!existing || existing.userId !== ctx.userId) {
      throw new SkillsEngineError(`Installed skill '${skillId}' not found.`, 'SKILL_NOT_FOUND', 404);
    }
    existing.config = { ...existing.config, ...config };
    existing.updatedAt = new Date().toISOString();
    await this.store.put(ctx, SKILLS_COLLECTION, skillId, existing);
    return existing;
  }

  public async removeSkill(ctx: DurableRequestContext, skillId: string): Promise<{ removed: boolean }> {
    const installed = await this.listInstalledSkills(ctx);
    const dependents = installed.filter(
      (s) => s.skillId !== skillId && s.dependencies.some((d) => d.skillId === skillId),
    );
    if (dependents.length > 0) {
      throw new SkillsEngineError(
        `Cannot remove '${skillId}' because installed skill(s) depend on it: ${dependents.map((d) => d.skillId).join(', ')}.`,
        'DEPENDENCY_IN_USE',
        409,
      );
    }
    await this.store.delete(ctx, SKILLS_COLLECTION, skillId);
    return { removed: true };
  }

  public async listInstalledSkills(ctx: DurableRequestContext): Promise<InstalledSkillRecord[]> {
    const all = await this.store.list<InstalledSkillRecord>(ctx, SKILLS_COLLECTION, 100);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async listExecutionHistory(
    ctx: DurableRequestContext,
    skillId?: string,
    limit = 50,
  ): Promise<SkillExecutionRecord[]> {
    const all = await this.store.list<SkillExecutionRecord>(ctx, SKILL_EXECUTIONS_COLLECTION, 150);
    return all
      .filter((e) => !skillId || e.skillId === skillId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, Math.min(100, Math.max(1, limit)));
  }

  /**
   * Intelligent skill auto-selection from enabled installed skills (with optional catalog match).
   */
  public async selectBestSkillForTask(
    ctx: DurableRequestContext,
    taskPrompt: string,
  ): Promise<{ skill: InstalledSkillRecord | null; score: number; reason: string }> {
    const installed = (await this.listInstalledSkills(ctx)).filter((s) => s.enabled);
    if (installed.length === 0) {
      return { skill: null, score: 0, reason: 'No enabled skills installed.' };
    }

    const tokens = taskPrompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    const tokenSet = new Set(tokens);

    let best: InstalledSkillRecord | null = null;
    let bestScore = 0;

    for (const skill of installed) {
      const skillCorpus = [
        skill.skillId,
        skill.name,
        skill.description,
        ...skill.tags,
        ...skill.supportedTools,
      ]
        .join(' ')
        .toLowerCase();

      let score = 0;
      for (const t of tokenSet) {
        if (skill.tags.some((tag) => tag.toLowerCase() === t)) score += 4;
        else if (skill.name.toLowerCase().includes(t)) score += 3;
        else if (skillCorpus.includes(t)) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        best = skill;
      }
    }

    if (!best || bestScore === 0) {
      return { skill: null, score: 0, reason: 'No installed skill strongly matched the task prompt.' };
    }

    return {
      skill: best,
      score: bestScore,
      reason: `Selected '${best.name}' v${best.version} (match score ${bestScore}).`,
    };
  }

  /**
   * Execute an installed & enabled skill.
   * - Declarative & tool_workflow skills return validated instructions, allowed tool contracts, and config.
   * - Code-bearing ('sandbox_code') skills ALWAYS execute strictly inside an isolated Feature 06 sandbox
   *   after passing Feature 02 permissions approval (NEVER executed on the Netlify host).
   */
  public async executeSkill(
    ctx: DurableRequestContext,
    input: {
      skillId: string;
      taskInput: string;
      approvalToken?: string;
      sandboxApprovalToken?: string;
      projectId?: string;
    },
  ): Promise<SkillExecutionRecord> {
    const skill = await this.store.get<InstalledSkillRecord>(ctx, SKILLS_COLLECTION, input.skillId);
    if (!skill || skill.userId !== ctx.userId) {
      throw new SkillsEngineError(`Installed skill '${input.skillId}' not found.`, 'SKILL_NOT_FOUND', 404);
    }
    if (!skill.enabled) {
      throw new SkillsEngineError(`Skill '${skill.skillId}' is currently disabled.`, 'SKILL_DISABLED', 409);
    }

    // Re-verify integrity before execution to guard against storage tampering
    const currentHash = computeSkillIntegrityHash({
      id: skill.skillId,
      version: skill.version,
      instructions: skill.instructions,
      executionType: skill.executionType,
      sandboxScript: skill.sandboxScript,
    });
    if (currentHash !== skill.integrityHash) {
      throw new SkillsEngineError(
        `Skill '${skill.skillId}' failed pre-execution SHA-256 integrity verification.`,
        'INTEGRITY_MISMATCH',
        403,
      );
    }

    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const executionId = `skexec_${startedMs}_${crypto.randomBytes(4).toString('hex')}`;

    try {
      let output: unknown;
      let sandboxId: string | undefined;

      if (skill.executionType === 'sandbox_code') {
        const permEval = await this.permissions.evaluateActionDurable(
          {
            toolName: 'skill_execute_sandbox',
            args: {
              skillId: skill.skillId,
              version: skill.version,
              entryCommand: skill.sandboxScript?.entryCommand || '',
            },
            userId: ctx.userId,
            target: `${skill.skillId}@${skill.version}`,
            approvalToken: input.approvalToken,
          },
          ctx,
          this.auditStore,
        );
        if (!permEval.allowed) {
          throw new SkillsEngineError(permEval.reason, 'APPROVAL_REQUIRED', 403, permEval.challenge);
        }

        const script = skill.sandboxScript!;
        const sandbox = await this.sandboxEngine.createSandbox(ctx, {
          projectId: input.projectId || `skill_${skill.skillId}`,
          runtime: script.runtime,
        });
        sandboxId = sandbox.sandboxId;

        for (const [relPath, content] of Object.entries(script.files)) {
          await this.sandboxEngine.writeFile(ctx, sandbox.sandboxId, relPath, content);
        }

        const execResult = await this.sandboxEngine.executeTerminal(ctx, {
          sandboxId: sandbox.sandboxId,
          command: script.entryCommand,
          timeoutMs: 30_000,
          approvalToken: input.sandboxApprovalToken,
        });

        output = {
          sandboxId: sandbox.sandboxId,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          status: execResult.status,
        };
      } else {
        output = {
          mode: skill.executionType,
          skillId: skill.skillId,
          version: skill.version,
          instructions: skill.instructions,
          supportedTools: skill.supportedTools,
          config: skill.config,
          appliedPrompt: input.taskInput.slice(0, 2000),
        };
      }

      const completedMs = Date.now();
      const record: SkillExecutionRecord = {
        executionId,
        userId: ctx.userId,
        skillId: skill.skillId,
        skillVersion: skill.version,
        executionType: skill.executionType,
        status: 'succeeded',
        inputSummary: input.taskInput.slice(0, 300),
        output,
        sandboxId,
        startedAt,
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - startedMs),
      };

      await this.store.put(ctx, SKILL_EXECUTIONS_COLLECTION, executionId, record);

      await this.permissions.recordSecurityAuditDurable(
        ctx,
        {
          action: 'skill_execute',
          category: 'skill_execution',
          resourceId: executionId,
          status: 'succeeded',
          details: { skillId: skill.skillId, version: skill.version, executionType: skill.executionType, sandboxId },
        },
        this.auditStore,
      );

      return record;
    } catch (err) {
      const completedMs = Date.now();
      const record: SkillExecutionRecord = {
        executionId,
        userId: ctx.userId,
        skillId: skill.skillId,
        skillVersion: skill.version,
        executionType: skill.executionType,
        status: err instanceof SkillsEngineError && err.code === 'APPROVAL_REQUIRED' ? 'denied' : 'failed',
        inputSummary: input.taskInput.slice(0, 300),
        error: err instanceof Error ? err.message : 'Skill execution failed.',
        startedAt,
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - startedMs),
      };
      await this.store.put(ctx, SKILL_EXECUTIONS_COLLECTION, executionId, record);
      throw err;
    }
  }
}

export const defaultSkillsEngine = new SkillsEcosystemEngine();
