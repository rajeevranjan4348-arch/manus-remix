import { describe, it, expect, beforeEach } from 'vitest';
import {
  DurableSkillsService,
  validateSkillManifest,
  SkillManifestError,
  compareVersions,
  manifestSourceHash,
  BUILTIN_SKILL_MANIFESTS,
} from '../server/skills/durableSkills';
import { InMemoryDurableStore } from '../server/durable/store';
import { permissionsGateway } from '../server/permissionsGateway';

function manifest(overrides: Record<string, any> = {}) {
  return {
    id: 'skill.sample',
    name: 'Sample Skill',
    description: 'A deterministic sample skill used by tests.',
    version: '1.0.0',
    author: 'test-suite',
    category: 'utilities' as const,
    instructions: 'Perform the sample task in ordered steps and verify the result.',
    supportedTools: ['web_search'],
    dependencies: [] as string[],
    permissions: [] as string[],
    compatibility: { minAgentPlatform: 'any', requiredRuntimes: [] as Array<'node' | 'python' | 'browser'>, toolFrameworkVersion: '1' },
    codeSandboxRequired: false,
    ...overrides,
  };
}

describe('Feature 04: Server-backed skills ecosystem', () => {
  let store: InMemoryDurableStore;
  let skills: DurableSkillsService;

  beforeEach(() => {
    store = new InMemoryDurableStore();
    permissionsGateway.attachDurableStore(store);
    skills = new DurableSkillsService(store);
  });

  it('validates manifests: semver, required fields, and protected tools', () => {
    const valid = validateSkillManifest(manifest());
    expect(valid.id).toBe('skill.sample');
    expect(() => validateSkillManifest(manifest({ version: 'not-semver' }))).toThrow(SkillManifestError);
    expect(() => validateSkillManifest(manifest({ name: '' }))).toThrow(SkillManifestError);
    expect(() => validateSkillManifest(manifest({ id: '' }))).toThrow(SkillManifestError);
    expect(() =>
      validateSkillManifest(manifest({ supportedTools: ['permissions_approve'] })),
    ).toThrow(/core security tools/);
    expect(() => validateSkillManifest(null)).toThrow(SkillManifestError);
  });

  it('computes a stable source hash and orders versions', () => {
    expect(manifestSourceHash(manifest())).toBe(manifestSourceHash(manifest()));
    expect(manifestSourceHash(manifest({ version: '2.0.0' }))).not.toBe(manifestSourceHash(manifest()));
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('lists built-in manifests with valid structure', () => {
    const builtins = skills.listBuiltins();
    expect(builtins.length).toBeGreaterThanOrEqual(2);
    for (const b of builtins) {
      expect(() => validateSkillManifest(b)).not.toThrow();
      expect(BUILTIN_SKILL_MANIFESTS.map((m) => m.id)).toContain(b.id);
    }
  });

  it('installs a skill durably with version metadata and integrity hash', async () => {
    const installed = await skills.install('usr_a', manifest());
    expect(installed.userId).toBe('usr_a');
    expect(installed.version).toBe('1.0.0');
    expect(installed.installedVersion).toBe('1.0.0');
    expect(installed.enabled).toBe(true);
    expect(installed.dependencyOk).toBe(true);
    expect(installed.sourceHash).toBe(manifestSourceHash(manifest()));

    const record = await skills.getInstallRecord('usr_a', 'skill.sample');
    expect(record).not.toBeNull();
    const otherUser = await skills.getInstallRecord('usr_b', 'skill.sample');
    expect(otherUser).toBeNull();
  });

  it('marks dependencyOk false and blocks execution when dependencies are missing', async () => {
    await skills.install('usr_dep', manifest({ dependencies: ['skill.missing-parent'] }));
    const record = await skills.getInstallRecord('usr_dep', 'skill.sample');
    expect(record!.dependencyOk).toBe(false);

    const execution = await skills.executeSkill({ userId: 'usr_dep', skillId: 'skill.sample', input: { q: 1 } });
    expect(execution.status).toBe('blocked');
    expect(execution.error).toContain('dependencies');
  });

  it('satisfies dependencies when the required skill is installed', async () => {
    await skills.install('usr_deps', manifest({ id: 'skill.parent', name: 'Parent' }));
    const child = await skills.install(
      'usr_deps',
      manifest({ id: 'skill.child', name: 'Child', dependencies: ['skill.parent'] }),
    );
    expect(child.dependencyOk).toBe(true);
  });

  it('updates skills to a higher version and stores version history', async () => {
    await skills.install('usr_a', manifest());
    const updated = await skills.update('usr_a', 'skill.sample', manifest({ version: '1.1.0' }));
    expect(updated.version).toBe('1.1.0');
    expect(updated.installedVersion).toBe('1.0.0');

    const oldVersionStored = await store.get('system_skill_versions', 'usr_a:skill.sample:1.0.0');
    expect(oldVersionStored).not.toBeNull();

    await expect(skills.update('usr_a', 'skill.sample', manifest({ version: '1.0.5' }))).rejects.toThrow(
      /must be greater than installed/,
    );
    await expect(skills.update('usr_a', 'skill.unknown', manifest())).rejects.toThrow(/not installed/);
  });

  it('rolls back to a previously installed version', async () => {
    await skills.install('usr_a', manifest());
    await skills.update('usr_a', 'skill.sample', manifest({ version: '1.1.0' }));
    const rolledBack = await skills.rollback('usr_a', 'skill.sample', '1.0.0');
    expect(rolledBack.version).toBe('1.0.0');
    await expect(skills.rollback('usr_a', 'skill.sample', '9.9.9')).rejects.toThrow(/No stored version/);
  });

  it('enable/disable gates execution', async () => {
    await skills.install('usr_a', manifest());
    const disabledRun = await skills.executeSkill({ userId: 'usr_a', skillId: 'skill.sample', input: {} });
    expect(disabledRun.status).toBe('completed');

    expect(await skills.setEnabled('usr_a', 'skill.sample', false)).toBe(true);
    const blockedRun = await skills.executeSkill({ userId: 'usr_a', skillId: 'skill.sample', input: {} });
    expect(blockedRun.status).toBe('blocked');
    expect(blockedRun.error).toContain('disabled');
  });

  it('records execution history per user and per skill', async () => {
    await skills.install('usr_hist', manifest());
    await skills.executeSkill({ userId: 'usr_hist', skillId: 'skill.sample', input: { q: 'first' } });
    await skills.executeSkill({ userId: 'usr_hist', skillId: 'skill.sample', input: { q: 'second' } });

    const history = await skills.listExecutionHistory('usr_hist', 'skill.sample');
    expect(history).toHaveLength(2);
    expect(new Set(history.map((h) => h.input.q))).toEqual(new Set(['first', 'second']));
    const otherUser = await skills.listExecutionHistory('usr_hist_other');
    expect(otherUser).toHaveLength(0);
  });

  it('requires gateway approval for skills that declare sensitive permissions', async () => {
    await skills.install(
      'usr_perm',
      manifest({ permissions: ['terminal_execute'] }),
    );
    const blocked = await skills.executeSkill({ userId: 'usr_perm', skillId: 'skill.sample', input: { cmd: 'ls' } });
    expect(blocked.status).toBe('blocked');
    expect(blocked.error).toBeTruthy();
  });

  it('never executes code-bearing skills on the host: sandbox requirement yields unavailable, not fake success', async () => {
    const codeSkill = BUILTIN_SKILL_MANIFESTS.find((s) => s.codeSandboxRequired)!;
    await skills.install('usr_code', codeSkill);
    const result = await skills.executeSkill({ userId: 'usr_code', skillId: codeSkill.id, input: {} });
    expect(['unavailable', 'blocked']).toContain(result.status);
    expect(result.output?.executedInSandbox ?? false).toBe(false);
  });

  it('uninstalls durably', async () => {
    await skills.install('usr_a', manifest());
    expect(await skills.uninstall('usr_a', 'skill.sample')).toBe(true);
    expect(await skills.getInstallRecord('usr_a', 'skill.sample')).toBeNull();
  });

  it('configures per-user skill settings', async () => {
    await skills.install('usr_cfg', manifest());
    expect(await skills.configure('usr_cfg', 'skill.sample', { depth: 'deep' })).toBe(true);
    const record = await skills.getInstallRecord('usr_cfg', 'skill.sample');
    expect(record!.configuration).toEqual({ depth: 'deep' });
    await expect(skills.configure('usr_cfg', 'skill.sample', 'not-an-object' as any)).rejects.toThrow(/Configuration/);
  });
});
