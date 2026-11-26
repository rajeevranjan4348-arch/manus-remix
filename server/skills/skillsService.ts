/**
 * Server-backed skills ecosystem service (Feature 04).
 *
 * Catalog, validation, install/update/rollback lifecycle, dependency and
 * compatibility checks, and execution. Third-party skills are untrusted:
 * prompt skills only ever return instructions (never executed as code);
 * code-bearing skills run exclusively inside the Feature 06 sandbox and fail
 * closed with an honest unavailable status when no sandbox is configured.
 */

import crypto from 'crypto';
import { SKILL_HARD_LIMITS, type SkillExecutionRecord, type SkillInstallState, type SkillManifest } from './types';
import type { SkillStore } from './skillStore';
import { resolveSkillStore } from './skillStore';
import { resolveWorkspacePath } from '../sandbox/pathGuard';
import { resolveProvider, isProviderAvailable } from '../sandbox/provider';
import { SandboxOrchestratorService } from '../sandbox/orchestrator';
import { resolveExecutionStore } from '../sandbox/executionStore';

/* ---------- Built-in catalog (curated, prompt-runtime skills) ---------- */

export const BUILTIN_CATALOG: SkillManifest[] = [
  {
    id: 'web-research-brief',
    name: 'Web Research Brief',
    description: 'Produces a sourced research brief on any topic using web search and page reading.',
    version: '1.0.0',
    author: 'manus-core',
    instructions: [
      '# Web Research Brief', '',
      '1. Search the live web for the requested topic with web_search (3 to 5 distinct queries).',
      '2. Read the two most authoritative sources with fetch_webpage.',
      '3. Produce a brief with: summary, key findings (each with a citation), open questions.',
      '4. Never invent citations; only cite pages actually retrieved.',
    ].join('\n'),
    supportedTools: ['web_search', 'fetch_webpage'],
    dependencies: [],
    permissions: ['web_search', 'fetch_webpage'],
    compat: { runtime: 'prompt' },
    entrypoint: null,
    files: [],
  },
  {
    id: 'react-vite-scaffold',
    name: 'React + Vite App Scaffold',
    description: 'Scaffolds a React/Vite project layout and prepares the sandbox commands to install, build, and preview it.',
    version: '1.1.0',
    author: 'manus-core',
    instructions: [
      '# React + Vite Scaffold', '',
      '1. Emit the standard Vite React project structure (index.html, src/main.jsx, src/App.jsx, package.json).',
      '2. Provide the exact sandbox commands: npm install, npm run build, npm run dev.',
      '3. Terminal execution and preview must go through the sandbox engine (Feature 06); never claim a preview URL without a real readiness probe.',
    ].join('\n'),
    supportedTools: ['filesystem_write', 'terminal_execute', 'preview_start'],
    dependencies: [],
    permissions: ['filesystem_write', 'terminal_execute', 'preview_start'],
    compat: { runtime: 'prompt' },
    entrypoint: null,
    files: [],
  },
  {
    id: 'code-quality-audit',
    name: 'Sandbox Code Quality Audit',
    description: 'Runs lint and complexity tooling inside an isolated sandbox against the workspace code. Requires a configured sandbox provider.',
    version: '1.0.0',
    author: 'manus-core',
    instructions: [
      '# Code Quality Audit', '',
      'Runs the packaged audit script inside the sandbox and returns the raw report. Requires the sandbox runtime.',
    ].join('\n'),
    supportedTools: ['sandbox_create', 'filesystem_write', 'terminal_execute', 'sandbox_cleanup'],
    dependencies: [],
    permissions: ['sandbox_create', 'filesystem_write', 'terminal_execute', 'sandbox_cleanup'],
    compat: { runtime: 'sandbox' },
    entrypoint: { file: 'skills/code-quality-audit/audit.mjs', command: 'node skills/code-quality-audit/audit.mjs' },
    files: [
      {
        path: 'skills/code-quality-audit/audit.mjs',
        content: [
          '// Minimal quality audit: reports file counts and obvious issues in the workspace.',
          "import { readdirSync, readFileSync, statSync } from 'node:fs';",
          "import { join, relative } from 'node:path';",
          'const root = process.cwd();',
          'const files = [];',
          'const walk = (dir) => {',
          "  for (const e of readdirSync(dir, { withFileTypes: true })) {",
          "    if (['node_modules', '.git'].includes(e.name)) continue;",
          '    const p = join(dir, e.name);',
          '    if (e.isDirectory()) walk(p); else files.push(p);',
          '  }',
          '};',
          'walk(root);',
          'const longFiles = files.filter((f) => { try { return readFileSync(f, "utf8").split("\\n").length > 400; } catch { return false; } });',
          'console.log(JSON.stringify({ filesScanned: files.length, longFiles: longFiles.map((f) => relative(root, f)) }));',
        ].join('\n'),
      },
    ],
  },
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export interface ManifestValidation {
  valid: boolean;
  error?: string;
}

export function validateManifest(manifest: unknown, source: 'builtin' | 'third-party'): ManifestValidation {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, error: 'Skill manifest must be an object.' };
  }
  const m = manifest as Partial<SkillManifest>;
  if (!SLUG_RE.test(String(m.id || ''))) return { valid: false, error: 'Skill id must match [a-z0-9][a-z0-9-]{2,63}.' };
  if (!SEMVER_RE.test(String(m.version || ''))) return { valid: false, error: 'Skill version must be MAJOR.MINOR.PATCH.' };
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 200) return { valid: false, error: 'Skill name is required (max 200 chars).' };
  if (typeof m.description !== 'string' || !m.description.trim() || m.description.length > SKILL_HARD_LIMITS.maxDescriptionChars) {
    return { valid: false, error: 'Skill description is required (max ' + SKILL_HARD_LIMITS.maxDescriptionChars + ' chars).' };
  }
  if (typeof m.instructions !== 'string' || !m.instructions.trim()) return { valid: false, error: 'Skill instructions are required.' };
  if (m.instructions.length > SKILL_HARD_LIMITS.maxInstructionsChars) return { valid: false, error: 'Skill instructions exceed ' + SKILL_HARD_LIMITS.maxInstructionsChars + ' chars.' };
  for (const listKey of ['supportedTools', 'dependencies', 'permissions'] as const) {
    const list = m[listKey];
    if (!Array.isArray(list) || list.some((t) => typeof t !== 'string' || !t.trim())) {
      return { valid: false, error: 'Skill ' + listKey + ' must be an array of non-empty strings.' };
    }
    if (list.length > SKILL_HARD_LIMITS.maxToolsListed) return { valid: false, error: 'Skill ' + listKey + ' exceeds ' + SKILL_HARD_LIMITS.maxToolsListed + ' entries.' };
  }
  const runtime = m.compat?.runtime;
  if (runtime !== 'prompt' && runtime !== 'sandbox') return { valid: false, error: 'compat.runtime must be "prompt" or "sandbox".' };
  if (runtime === 'prompt' && m.entrypoint) {
    // Prompt skills never execute code. An entrypoint here would imply host execution.
    return { valid: false, error: 'Prompt-runtime skills must not declare an entrypoint (code is never executed on the host).' };
  }
  if (runtime === 'sandbox') {
    if (!m.entrypoint || typeof m.entrypoint.file !== 'string' || typeof m.entrypoint.command !== 'string') {
      return { valid: false, error: 'Sandbox-runtime skills must declare an entrypoint file and command.' };
    }
    const resolved = resolveWorkspacePath(m.entrypoint.file);
    if (!resolved.valid) return { valid: false, error: 'Entrypoint path failed the workspace path guard: ' + String(resolved.error) };
    const files = Array.isArray(m.files) ? m.files : [];
    if (runtime === 'sandbox' && files.length === 0) return { valid: false, error: 'Sandbox-runtime skills must ship their payload files.' };
    if (files.length > SKILL_HARD_LIMITS.maxFiles) return { valid: false, error: 'Skills ship at most ' + SKILL_HARD_LIMITS.maxFiles + ' files.' };
    for (const f of files) {
      const check = resolveWorkspacePath(f.path);
      if (!check.valid) return { valid: false, error: 'Skill file path failed the workspace path guard: ' + String(f.path) };
      if (typeof f.content !== 'string' || f.content.length > SKILL_HARD_LIMITS.maxFileBytes) {
        return { valid: false, error: 'Skill files are capped at ' + SKILL_HARD_LIMITS.maxFileBytes + ' bytes each.' };
      }
    }
  }
  if (source === 'third-party' && (!m.author || String(m.author).trim().length < 2)) {
    return { valid: false, error: 'Third-party skill manifests must declare an author.' };
  }
  return { valid: true };
}

export interface DependencyReport {
  satisfied: boolean;
  missing: string[];
}

export function checkDependencies(manifest: SkillManifest, installedIds: string[]): DependencyReport {
  const installed = new Set(installedIds);
  const missing = (manifest.dependencies || []).filter((d) => !installed.has(d));
  return { satisfied: missing.length === 0, missing };
}

/** Keyword ranking used by the agent to pick the best compatible installed skill. */
export function rankSkillsForTask(installed: SkillInstallState[], task: string): SkillInstallState[] {
  const words = task.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const score = (s: SkillInstallState): number => {
    const hay = (s.activeManifest.id + ' ' + s.activeManifest.name + ' ' + s.activeManifest.description).toLowerCase();
    return words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
  };
  return installed
    .filter((s) => s.enabled && s.status === 'installed')
    .map((s) => ({ s, score: score(s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}

export interface ExecuteOptions {
  approvalToken?: string;
  evaluateAction?: (p: { toolName: string; args: Record<string, unknown>; userId: string; approvalToken?: string }) => Promise<{ allowed: boolean; reason: string }>;
}

export class SkillsService {
  constructor(private readonly store: SkillStore = null as unknown as SkillStore) {
    if (!this.store) throw new Error('SkillsService requires a store');
  }

  static async create(): Promise<SkillsService> {
    return new SkillsService(await resolveSkillStore());
  }

  catalog(): SkillManifest[] {
    return BUILTIN_CATALOG.map((m) => ({ ...m }));
  }

  async search(userId: string, query: string): Promise<{ catalog: SkillManifest[]; installed: SkillInstallState[] }> {
    const q = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const match = (text: string): boolean => q.length === 0 || q.some((w) => text.toLowerCase().includes(w));
    const inCatalog = this.catalog().filter((m) => match(m.id + ' ' + m.name + ' ' + m.description));
    const installed = (await this.store.listInstalls(userId)).filter((s) => match(s.activeManifest.id + ' ' + s.activeManifest.name + ' ' + s.activeManifest.description));
    return { catalog: inCatalog, installed };
  }

  async selectForTask(userId: string, task: string): Promise<SkillInstallState[]> {
    return rankSkillsForTask(await this.store.listInstalls(userId), task);
  }

  async install(userId: string, manifest: SkillManifest, opts: { source?: 'builtin' | 'third-party' } = {}): Promise<SkillInstallState> {
    const source = opts.source || 'third-party';
    const validation = validateManifest(manifest, source);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.error || 'Invalid skill manifest.'), { code: 'INVALID_SKILL_MANIFEST', status: 400 });
    }
    const existing = await this.store.listInstalls(userId);
    if (existing.length >= SKILL_HARD_LIMITS.maxSkillsPerUser) {
      throw Object.assign(new Error('Skill limit reached (' + SKILL_HARD_LIMITS.maxSkillsPerUser + ').'), { code: 'SKILL_LIMIT_REACHED', status: 409 });
    }
    const dup = existing.find((s) => s.skillId === manifest.id);
    if (dup && dup.installedVersion === manifest.version) {
      throw Object.assign(new Error('Skill already installed at this version.'), { code: 'SKILL_ALREADY_INSTALLED', status: 409 });
    }
    const dep = checkDependencies(manifest, existing.map((s) => s.skillId));
    if (!dep.satisfied) {
      throw Object.assign(new Error('Missing skill dependencies: ' + dep.missing.join(', ')), { code: 'DEPENDENCY_MISSING', status: 400 });
    }
    const builtin = BUILTIN_CATALOG.find((m) => m.id === manifest.id);
    const now = new Date().toISOString();
    if (dup) {
      // Treat as update preserving history.
      const state = await this.applyVersion(dup, manifest, now);
      await this.store.putInstall(state);
      return state;
    }
    const state: SkillInstallState = {
      skillId: manifest.id,
      userId,
      status: 'installed',
      enabled: true,
      installedVersion: manifest.version,
      activeManifest: { ...manifest },
      versionHistory: [{ version: manifest.version, manifest: { ...manifest }, updatedAt: now }],
      source: builtin && JSON.stringify(builtin) === JSON.stringify(manifest) ? 'builtin' : source,
      installedAt: now,
      updatedAt: now,
    };
    await this.store.putInstall(state);
    return state;
  }

  private applyVersion(state: SkillInstallState, manifest: SkillManifest, now: string): SkillInstallState {
    const history = state.versionHistory.filter((v) => v.version !== manifest.version);
    history.push({ version: manifest.version, manifest: { ...manifest }, updatedAt: now });
    while (history.length > SKILL_HARD_LIMITS.maxVersionHistory) history.shift();
    return { ...state, installedVersion: manifest.version, activeManifest: { ...manifest }, versionHistory: history, updatedAt: now };
  }

  async update(userId: string, manifest: SkillManifest, opts: { source?: 'builtin' | 'third-party' } = {}): Promise<SkillInstallState> {
    const validation = validateManifest(manifest, opts.source || 'third-party');
    if (!validation.valid) {
      throw Object.assign(new Error(validation.error || 'Invalid skill manifest.'), { code: 'INVALID_SKILL_MANIFEST', status: 400 });
    }
    const state = await this.store.getInstall(manifest.id, userId);
    if (!state) {
      throw Object.assign(new Error('Skill is not installed.'), { code: 'SKILL_NOT_INSTALLED', status: 404 });
    }
    if (state.installedVersion === manifest.version) {
      throw Object.assign(new Error('Already up to date at version ' + manifest.version + '.'), { code: 'SKILL_UP_TO_DATE', status: 409 });
    }
    const installed = await this.store.listInstalls(userId);
    const dep = checkDependencies(manifest, installed.map((s) => s.skillId));
    if (!dep.satisfied) {
      throw Object.assign(new Error('Missing skill dependencies: ' + dep.missing.join(', ')), { code: 'DEPENDENCY_MISSING', status: 400 });
    }
    const updated = this.applyVersion(state, manifest, new Date().toISOString());
    await this.store.putInstall(updated);
    return updated;
  }

  async rollback(userId: string, skillId: string, toVersion: string): Promise<SkillInstallState> {
    const state = await this.store.getInstall(skillId, userId);
    if (!state) {
      throw Object.assign(new Error('Skill is not installed.'), { code: 'SKILL_NOT_INSTALLED', status: 404 });
    }
    const target = state.versionHistory.find((v) => v.version === toVersion);
    if (!target) {
      throw Object.assign(new Error('Version ' + toVersion + ' is not in this skill history.'), { code: 'VERSION_NOT_FOUND', status: 404 });
    }
    if (state.installedVersion === toVersion) return state;
    const rolled: SkillInstallState = { ...state, installedVersion: toVersion, activeManifest: { ...target.manifest }, updatedAt: new Date().toISOString() };
    await this.store.putInstall(rolled);
    return rolled;
  }

  async uninstall(userId: string, skillId: string): Promise<void> {
    const state = await this.store.getInstall(skillId, userId);
    if (!state) {
      throw Object.assign(new Error('Skill is not installed.'), { code: 'SKILL_NOT_INSTALLED', status: 404 });
    }
    const dependents = (await this.store.listInstalls(userId)).filter((s) => s.activeManifest.dependencies.includes(skillId));
    if (dependents.length > 0) {
      throw Object.assign(new Error('Cannot remove: installed by dependency of ' + dependents.map((d) => d.skillId).join(', ')), { code: 'DEPENDENT_SKILLS', status: 409 });
    }
    await this.store.deleteInstall(skillId, userId);
  }

  async setEnabled(userId: string, skillId: string, enabled: boolean): Promise<SkillInstallState> {
    const state = await this.store.getInstall(skillId, userId);
    if (!state) {
      throw Object.assign(new Error('Skill is not installed.'), { code: 'SKILL_NOT_INSTALLED', status: 404 });
    }
    const next: SkillInstallState = { ...state, enabled, updatedAt: new Date().toISOString() };
    await this.store.putInstall(next);
    return next;
  }

  async recordExecution(record: Omit<SkillExecutionRecord, 'executionId' | 'durable'>): Promise<SkillExecutionRecord> {
    const full: SkillExecutionRecord = {
      ...record,
      executionId: 'skx_' + crypto.randomBytes(10).toString('hex'),
      durable: this.store.durable,
    };
    await this.store.appendExecution(full);
    return full;
  }

  async listExecutions(userId: string, skillId?: string, limit = 50): Promise<SkillExecutionRecord[]> {
    return this.store.listExecutions(userId, skillId, limit);
  }

  /**
   * Execute an installed, enabled skill.
   * - Prompt skills return their instruction bundle for the agent (marked
   *   instructions_only so no one can mistake it for code execution).
   * - Sandbox skills run their entrypoint inside the Feature 06 sandbox.
   *   Without a configured sandbox provider they are REFUSED honestly.
   */
  async execute(userId: string, skillId: string, args: Record<string, unknown>, opts: ExecuteOptions = {}): Promise<{ record: SkillExecutionRecord; result?: Record<string, unknown>; challenge?: unknown }> {
    const startedAt = new Date().toISOString();
    const state = await this.store.getInstall(skillId, userId);
    if (!state || state.status !== 'installed') {
      const record = await this.recordExecution({ skillId, userId, version: '-', status: 'refused', reason: 'SKILL_NOT_INSTALLED', startedAt, finishedAt: new Date().toISOString() });
      throw Object.assign(new Error('Skill is not installed.'), { code: 'SKILL_NOT_INSTALLED', status: 404 });
    }
    const manifest = state.activeManifest;
    if (!state.enabled) {
      const record = await this.recordExecution({ skillId, userId, version: manifest.version, status: 'refused', reason: 'SKILL_DISABLED', startedAt, finishedAt: new Date().toISOString() });
      return { record };
    }

    // Feature 02 integration: skills pass the durable permission gateway.
    if (opts.evaluateAction) {
      const decision = await opts.evaluateAction({ toolName: 'skill_execute', args: { skillId, version: manifest.version, args }, userId, approvalToken: opts.approvalToken });
      if (!decision.allowed) {
        const record = await this.recordExecution({ skillId, userId, version: manifest.version, status: 'refused', reason: 'PERMISSION_DENIED: ' + decision.reason, startedAt, finishedAt: new Date().toISOString() });
        return { record };
      }
    }

    if (manifest.compat.runtime === 'prompt') {
      const result = {
        instructions_only: true,
        instructions: manifest.instructions,
        supportedTools: manifest.supportedTools,
        permissions: manifest.permissions,
        note: 'Prompt skill: the returned instructions are for the agent. No code was executed.',
      };
      const record = await this.recordExecution({ skillId, userId, version: manifest.version, status: 'completed', reason: 'instructions bundle returned', result, startedAt, finishedAt: new Date().toISOString() });
      return { record, result };
    }

    // Sandbox runtime: execute inside Feature 06 or fail closed.
    const resolved = resolveProvider();
    if (!isProviderAvailable(resolved)) {
      const record = await this.recordExecution({
        skillId, userId, version: manifest.version, status: 'refused',
        reason: 'SKILL_SANDBOX_UNAVAILABLE: no sandbox provider configured; skill code was not executed.',
        startedAt, finishedAt: new Date().toISOString(),
      });
      throw Object.assign(new Error('Code-bearing skill requires a configured sandbox provider (Feature 06). Configure E2B credentials to run it.'), { code: 'SKILL_SANDBOX_UNAVAILABLE', status: 503 });
    }

    const execStore = await resolveExecutionStore();
    const orchestrator = new SandboxOrchestratorService(async () => ({
      store: execStore,
      provider: resolved.provider,
      audit: () => {},
      evaluateApproval: () => ({ allowed: true, requiresApproval: false, riskLevel: 'sensitive', reason: 'Approved via skill_execute gateway decision.' }),
    }));
    try {
      const session = await orchestrator.createSession(userId, { userId, runtime: 'node', workspaceLabel: 'skill-' + manifest.id });
      for (const f of manifest.files || []) {
        await orchestrator.fsWrite(userId, session.sessionId, f.path, f.content, true);
      }
      const execution = await orchestrator.executeCommand(userId, session.sessionId, { command: manifest.entrypoint!.command, timeoutSeconds: 120 });
      await orchestrator.cleanup(userId, session.sessionId);
      const ok = execution.status === 'completed';
      const result = { sandbox: true, exitCode: execution.exitCode, stdout: execution.stdout.slice(0, 10000), stderr: execution.stderr.slice(0, 5000), sessionId: session.sessionId, executionId: execution.executionId };
      const record = await this.recordExecution({
        skillId, userId, version: manifest.version,
        status: ok ? 'completed' : 'failed',
        reason: ok ? 'sandbox command completed' : 'sandbox command failed (exit ' + String(execution.exitCode) + ')',
        result, startedAt, finishedAt: new Date().toISOString(),
      });
      return { record, result };
    } catch (err: any) {
      const record = await this.recordExecution({ skillId, userId, version: manifest.version, status: 'failed', reason: 'SANDBOX_EXECUTION_FAILED: ' + String(err?.message || ''), startedAt, finishedAt: new Date().toISOString() });
      throw err;
    }
  }
}
