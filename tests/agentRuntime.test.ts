import { describe, expect, it, afterEach } from 'vitest';

import { MemoryAgentStore } from '../server/agents/agentStore';
import { AgentRuntimeService, validatePlan } from '../server/agents/agentRuntime';
import { resolveModelProvider, type ModelCallResult, type ModelMessage, type ModelCallOptions } from '../server/agents/modelProvider';
import type { AgentRunRecord, SubtaskSpec } from '../server/agents/types';

function usage(total: number) {
  return { promptTokens: total, completionTokens: 0, totalTokens: total, costUsd: 0 };
}

interface ScriptConf { text?: string; fail?: string; delayMs?: number; tokens?: number; }
type ScriptFn = (messages: ModelMessage[], callIndex: number, opts?: ModelCallOptions) => ScriptConf;

/** Fake model caller: deterministic, records calls, honors abort signals. */
function makeRuntime(script?: ScriptFn) {
  const store = new MemoryAgentStore();
  const calls: Array<{ messages: ModelMessage[]; startOrder: number; concurrentAtStart: number; doneOrder: number; role: string }> = [];
  let started = 0;
  let finished = 0;
  let inFlight = 0;
  let maxConcurrent = 0;
  const caller = async (messages: ModelMessage[], opts?: ModelCallOptions): Promise<ModelCallResult> => {
    const startOrder = ++started;
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    calls.push({ messages, startOrder, concurrentAtStart: inFlight, doneOrder: -1, role: String(messages[0]?.content || '').slice(0, 24) });
    const idx = calls.length - 1;
    const conf = script ? script(messages, idx, opts) : { text: 'SCRIPTED OUTPUT ' + idx };
    if (conf.delayMs) {
      await new Promise<void>((resolve, rejectSignal) => {
        const t = setTimeout(() => resolve(), conf.delayMs as number);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rejectSignal();
        }, { once: true });
      }).catch(() => {
        inFlight -= 1;
        finished += 1;
        calls[idx].doneOrder = ++finished;
        throw Object.assign(new Error('ABORTED'), { code: 'ABORTED' });
      });
    }
    inFlight -= 1;
    calls[idx].doneOrder = ++finished;
    if (conf.fail) throw Object.assign(new Error(conf.fail), { code: conf.fail });
    return { content: conf.text ?? 'SCRIPTED OUTPUT ' + idx, usage: usage(conf.tokens ?? 10), modelId: 'fake-model' };
  };
  const reviewerIsCall = (messages: ModelMessage[]) => String(messages[0]?.content || '').includes('final reviewer');
  return { service: new AgentRuntimeService(store, caller), store, calls, maxConcurrent: () => maxConcurrent, reviewerIsCall };
}

const sub = (id: string, role: SubtaskSpec['role'], instructions: string, dependsOn: string[] = []): SubtaskSpec =>
  ({ id, role, title: id, instructions, dependsOn });

function getReviewerText(run: AgentRunRecord | null): string { return run?.reviewer?.output || ''; }

describe('Feature 03: plan validation', () => {
  it('rejects duplicate ids, unknown roles, and dependency cycles', () => {
    expect(validatePlan([sub('a', 'research', 'x'), sub('a', 'coding', 'y')]).valid).toBe(false);
    expect(validatePlan([sub('a', 'chief officer' as SubtaskSpec['role'], 'x')]).valid).toBe(false);
    expect(validatePlan([sub('a', 'research', 'x', ['b']), sub('b', 'coding', 'y', ['a'])]).valid).toBe(false);
    expect(validatePlan([sub('a', 'research', 'x', ['a'])]).valid).toBe(false);
    expect(validatePlan([]).valid).toBe(false);
  });

  it('accepts a well-formed dependency plan', () => {
    expect(validatePlan([sub('a', 'research', 'r'), sub('b', 'coding', 'c', ['a'])]).valid).toBe(true);
  });
});

describe('Feature 03: fail-closed execution', () => {
  afterEach(() => {
    delete process.env.AGENT_MODEL_API_KEY;
    delete process.env.AGENT_MODEL_BASE_URL;
    delete process.env.AGENT_MODEL_ID;
  });

  it('reports model provider as unavailable without credentials', () => {
    delete process.env.AGENT_MODEL_API_KEY;
    delete process.env.AGENT_MODEL_BASE_URL;
    delete process.env.AGENT_MODEL_ID;
    const resolved = resolveModelProvider();
    expect(resolved.available).toBe(false);
    expect(resolved.reason).toContain('not configured');
  });

  it('refuses to fabricate a plan when no provider is configured', async () => {
    delete process.env.AGENT_MODEL_API_KEY;
    delete process.env.AGENT_MODEL_BASE_URL;
    delete process.env.AGENT_MODEL_ID;
    const { service } = makeRuntime();
    await expect(service.createRun('userA', 'Do a thing')).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE' });
  });

  it('executes agent runs only for their owner', async () => {
    const { service } = makeRuntime(undefined, );
    const run = await service.createRun('userA', 'Obj', [sub('a', 'research', 'x')]);
    await expect(service.executeRun('userB', run.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await expect(service.executeRun('userA', 'run_missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});

describe('Feature 03: dependency and parallel execution', () => {
  it('passes dependency output to the dependent agent and preserves order', async () => {
    const { service, calls } = makeRuntime((messages, idx) => ({ text: 'OUTPUT-' + idx, tokens: 5 }));
    const run = await service.createRun('userA', 'Build demo', [
      sub('research', 'research', 'find facts'),
      sub('code', 'coding', 'write code', ['research']),
    ]);
    const reviewerPatch = (messages: ModelMessage[]) =>
      reviewerText(messages) ? 'PASS everything checks out' : undefined;
    function reviewerText(messages: ModelMessage[]) { return String(messages[0]?.content || '').includes('final reviewer') ? true : false; }
    // Rerun with reviewer-aware script: simpler to just verify structure below.
    await service.executeRun('userA', run.runId);
    const codeInput = calls[1].messages[1].content;
    expect(calls[0].startOrder).toBeLessThan(calls[1].startOrder);
    expect(calls[0].doneOrder).toBeLessThan(calls[1].startOrder); // sequential dependency respected
    expect(codeInput).toContain('OUTPUT-0'); // A's real output was passed to B
  });

  it('executes independent subtasks in parallel', async () => {
    const { service, maxConcurrent } = makeRuntime((_m, _i, opts) => ({
      text: 'out',
      tokens: 5,
      // Both agents overlap: each waits briefly; the abort listener keeps the fake honest.
      get delayMs() { return 40; },
      ...(opts ? {} : {}),
    }));
    const run = await service.createRun('userA', 'Two probes', [
      sub('p1', 'analysis', 'a'), sub('p2', 'testing', 'b'),
    ]);
    await service.executeRun('userA', run.runId);
    expect(maxConcurrent()).toBeGreaterThanOrEqual(2);
  });

  it('marks dependents as skipped when a dependency fails', async () => {
    const { service } = makeRuntime((_m, idx) => (idx === 0 ? { fail: 'BOOM_TOKENS' } : { text: 'should not be needed' }));
    const run = await service.createRun('userA', 'Failing chain', [
      sub('a', 'research', 'x'), sub('b', 'coding', 'y', ['a']),
    ]);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('failed');
    const bResult = result.results.find((r) => r.subtaskId === 'b');
    expect(bResult?.status).toBe('skipped');
    expect(bResult?.error).toContain('SKIPPED');
    const aResult = result.results.find((r) => r.subtaskId === 'a');
    expect(aResult?.status).toBe('failed');
    expect(aResult?.error).toBe('BOOM_TOKENS');
  });
});

describe('Feature 03: budgets, timeout, cancellation', () => {
  it('stops spending once the token budget is exhausted and skips the rest', async () => {
    const { service } = makeRuntime((_m, idx) => ({ text: 'out ' + idx, tokens: 60 }));
    const run = await service.createRun('userA', 'Budget test', [
      sub('a', 'research', 'x'), sub('b', 'coding', 'y', ['a']), sub('c', 'analysis', 'z', ['b']),
    ], { budgets: { maxTokens: 100 } });
    const result = await service.executeRun('userA', run.runId);
    const cResult = result.results.find((r) => r.subtaskId === 'c');
    expect(cResult?.status).toBe('skipped');
    expect(cResult?.error).toBe('SKIPPED_BUDGET_EXCEEDED');
    expect(result.totalUsage.totalTokens).toBeLessThanOrEqual(120); // a + b ran (60 each), c skipped
  });

  it('marks an agent as timed out without fabricating output', async () => {
    const { service } = makeRuntime((_m, _i, opts) => ({
      text: 'late', tokens: 5, delayMs: 3000,
      ...(opts?.signal?.aborted ? {} : {}),
    }));
    const run = await service.createRun('userA', 'Timeout test', [sub('slow', 'research', 'x')], { budgets: { timeoutSeconds: 1 } });
    const result = await service.executeRun('userA', run.runId);
    const slow = result.results.find((r) => r.subtaskId === 'slow');
    expect(slow?.status).toBe('failed');
    expect(slow?.error).toBe('AGENT_TIMEOUT');
    expect(slow?.output).toBe('');
  });

  it('honours a pre-cancelled run and cancels all pending subtasks', async () => {
    const { service } = makeRuntime(() => ({ text: 'out', tokens: 5 }), );
    const run = await service.createRun('userA', 'Cancel test', [sub('a', 'research', 'x'), sub('b', 'coding', 'y')]);
    await service.cancelRun('userA', run.runId);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('cancelled');
    expect(result.results.every((r) => r.status === 'cancelled')).toBe(true);
  });
});

describe('Feature 03: reviewer gate and usage accounting', () => {
  it('requires a PASS from the final reviewer to complete the run', async () => {
    const { service } = makeRuntime((messages, idx) => {
      const isReviewer = String(messages[0]?.content || '').includes('final reviewer');
      if (isReviewer) return { text: 'FAIL objective not met', tokens: 5 };
      return { text: 'work output ' + idx, tokens: 5 };
    });
    const run = await service.createRun('userA', 'Review test', [sub('a', 'research', 'x')]);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('REVIEWER_REJECTED');
    expect(result.reviewer?.passed).toBe(false);
    expect(getReviewerText(result)).toContain('FAIL');
  });

  it('completes when the reviewer passes and accumulates real usage', async () => {
    const { service } = makeRuntime((messages, idx) => {
      const isReviewer = String(messages[0]?.content || '').includes('final reviewer');
      if (isReviewer) return { text: 'PASS verified against the objective', tokens: 7 };
      return { text: 'work output ' + idx, tokens: 11 };
    });
    const run = await service.createRun('userA', 'Complete test', [sub('a', 'research', 'x'), sub('b', 'coding', 'y', ['a'])]);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('completed');
    expect(result.reviewer?.passed).toBe(true);
    expect(result.totalUsage.totalTokens).toBe(11 * 2 + 7);
    expect(result.results.every((r) => r.status === 'completed')).toBe(true);
    expect(result.results.every((r) => r.modelId === 'fake-model')).toBe(true);
  });

  it('fails honestly when the reviewer call itself is unavailable', async () => {
    const { service } = makeRuntime((messages, idx) => {
      const isReviewer = String(messages[0]?.content || '').includes('final reviewer');
      if (isReviewer) return { fail: 'MODEL_PROVIDER_UNAVAILABLE' };
      return { text: 'work output ' + idx, tokens: 5 };
    });
    const run = await service.createRun('userA', 'Reviewer outage test', [sub('a', 'research', 'x')]);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('REVIEWER_UNAVAILABLE');
  });
});
