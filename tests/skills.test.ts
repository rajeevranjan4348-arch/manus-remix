import { describe, expect, it, beforeEach } from 'vitest';

import { MemorySkillStore } from '../server/skills/skillStore';
import { SkillsService, validateManifest, checkDependencies, BUILTIN_CATALOG } from '../server/skills/skillsService';
import type { SkillManifest, SkillStore } from '../server/skills/types';

function store(): SkillStore {
  return new MemorySkillStore();
}

function service(s: SkillStore): SkillsService {
  return new SkillsService(s);
}

const validManifest = (): SkillManifest => ({
  id: 'my-third-party-skill',
  name: 'My Third-party Skill',
  description: 'A test skill that returns instructions for the agent.',
  version: '1.2.0',
  author: 'someone-trusted',
  instructions: 'Do the task carefully.',
  supportedTools: ['web_search'],
  dependencies: [],
  permissions: ['web_search'],
  compat: { runtime: 'prompt' },
  entrypoint: null,
  files: [],
});

describe('Feature 04: manifest validation (untrusted third-party skills)', () => {
  it('rejects malformed ids, versions, and wrong entrypoint rules', () => {
    expect(validateManifest({ ...validManifest(), id: 'Bad Id' }, 'third-party').valid).toBe(false);
    expect(validateManifest({ ...validManifest(), version: '1.0' }, 'third-party').valid).toBe(false);
    expect(validateManifest({ ...validManifest(), instructions: '' }, 'third-party').valid).toBe(false);
    expect(validateManifest({ ...validManifest(), author: '' }, 'third-party').valid).toBe(false);
    // A prompt-runtime skill must never declare an entrypoint (host code execution).
    expect(validateManifest({ ...validManifest(), entrypoint: { file: 'run.js', command: 'node run.js' } }, 'third-party').valid).toBe(false);
  });

  it('requires shipped payload files and guarded paths for sandbox skills', () => {
    const sbx: SkillManifest = {
      ...validManifest(),
      compat: { runtime: 'sandbox' },
      entrypoint: { file: 'skills/x/run.mjs', command: 'node skills/x/run.mjs' },
      files: [{ path: '../escape.mjs', content: 'evil' }],
    };
    expect(validateManifest(sbx, 'third-party').valid).toBe(false);
    expect(validateManifest({ ...sbx, files: [] }, 'third-party').valid).toBe(false);
    expect(validateManifest({ ...sbx, files: [{ path: 'skills/x/run.mjs', content: 'ok' }] }, 'third-party').valid).toBe(true);
  });
});

describe('Feature 04: install / update / rollback lifecycle', () => {
  let s: SkillStore;
  beforeEach(() => { s = store(); });

  it('installs a manifest with dependency validation and history', async () => {
    const svc = service(s);
    const state = await svc.install('userA', validManifest(), { source: 'third-party' });
    expect(state.installedVersion).toBe('1.2.0');
    expect(state.enabled).toBe(true);
    // Duplicate at the same version is refused.
    await expect(svc.install('userA', validManifest(), { source: 'third-party' })).rejects.toMatchObject({ code: 'SKILL_ALREADY_INSTALLED' });
    // Missing dependencies are refused.
    const dep = { ...validManifest(), id: 'dependent-skill', dependencies: ['my-third-party-skill'] };
    await expect(svc.install('userB', dep, { source: 'third-party' })).rejects.toMatchObject({ code: 'DEPENDENCY_MISSING' });
    expect(checkDependencies(dep, ['my-third-party-skill']).satisfied).toBe(true);
    expect(checkDependencies(dep, []).missing).toEqual(['my-third-party-skill']);
  });

  it('updates, keeps bounded version history, and rolls back', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    const v2 = { ...validManifest(), version: '1.3.0', description: 'updated description' };
    const updated = await svc.update('userA', v2, { source: 'third-party' });
    expect(updated.installedVersion).toBe('1.3.0');
    await expect(svc.update('userA', v2, { source: 'third-party' })).rejects.toMatchObject({ code: 'SKILL_UP_TO_DATE' });
    const rolled = await svc.rollback('userA', 'my-third-party-skill', '1.2.0');
    expect(rolled.installedVersion).toBe('1.2.0');
    expect(rolled.activeManifest.description).toBe('A test skill that returns instructions for the agent.');
    await expect(svc.rollback('userA', 'my-third-party-skill', '9.9.9')).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('blocks removal while dependent skills are installed', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    await svc.install('userA', { ...validManifest(), id: 'dependent-skill', dependencies: ['my-third-party-skill'] }, { source: 'third-party' });
    await expect(svc.uninstall('userA', 'my-third-party-skill')).rejects.toMatchObject({ code: 'DEPENDENT_SKILLS' });
    await svc.uninstall('userA', 'dependent-skill');
    await svc.uninstall('userA', 'my-third-party-skill');
    await expect(svc.setEnabled('userA', 'my-third-party-skill', true)).rejects.toMatchObject({ code: 'SKILL_NOT_INSTALLED' });
  });
});

describe('Feature 04: execution via the tool framework gates', () => {
  let s: SkillStore;
  beforeEach(() => { s = store(); });

  it('disabled skills are refused, with the refusal recorded in history', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    await svc.setEnabled('userA', 'my-third-party-skill', false);
    const outcome = await svc.execute('userA', 'my-third-party-skill', {});
    expect(outcome.record.status).toBe('refused');
    expect(outcome.record.reason).toBe('SKILL_DISABLED');
    expect(outcome.result).toBeUndefined();
  });

  it('prompt skills return an instructions bundle, never fake code results', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    const outcome = await svc.execute('userA', 'my-third-party-skill', {}, {
      evaluateAction: async () => ({ allowed: true, reason: 'ok' }),
    });
    expect(outcome.record.status).toBe('completed');
    expect(outcome.result?.instructions_only).toBe(true);
    expect(String(outcome.result?.instructions)).toContain('Do the task carefully');
    const history = await svc.listExecutions('userA');
    expect(history.length).toBe(1);
  });

  it('permission denial goes through the injected gateway and is audited', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    const outcome = await svc.execute('userA', 'my-third-party-skill', {}, {
      evaluateAction: async () => ({ allowed: false, reason: 'No approval token.' }),
    });
    expect(outcome.record.status).toBe('refused');
    expect(outcome.record.reason).toContain('PERMISSION_DENIED');
  });

  it('code-bearing skills fail closed without a sandbox provider and never touch the host', async () => {
    process.env.SANDBOX_PROVIDER = '';
    const svc = service(s);
    const sbx: SkillManifest = {
      ...validManifest(),
      compat: { runtime: 'sandbox' },
      entrypoint: { file: 'skills/x/run.mjs', command: 'node skills/x/run.mjs' },
      files: [{ path: 'skills/x/run.mjs', content: 'console.log(1)' }],
    };
    await svc.install('userA', sbx, { source: 'third-party' });
    await expect(svc.execute('userA', 'my-third-party-skill', {}, {
      evaluateAction: async () => ({ allowed: true, reason: 'ok' }),
    })).rejects.toMatchObject({ code: 'SKILL_SANDBOX_UNAVAILABLE' });
    const history = await svc.listExecutions('userA', 'my-third-party-skill');
    expect(history[0]?.status).toBe('refused');
    expect(history[0]?.reason).toContain('SKILL_SANDBOX_UNAVAILABLE');
  });

  it('selects the best compatible installed skill for a task', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    await svc.install('userA', { ...BUILTIN_CATALOG[0] }, { source: 'builtin' });
    const picked = await svc.selectForTask('userA', 'I need a research brief on coastal erosion');
    expect(picked[0]?.skillId).toBe('web-research-brief');
  });

  it('search covers catalog and installed skills', async () => {
    const svc = service(s);
    await svc.install('userA', validManifest(), { source: 'third-party' });
    const res = await svc.search('userA', 'research');
    expect(res.catalog.some((m) => m.id === 'web-research-brief')).toBe(true);
    const res2 = await svc.search('userA', 'third-party');
    expect(res2.installed.some((s2) => s2.skillId === 'my-third-party-skill')).toBe(true);
  });
});
