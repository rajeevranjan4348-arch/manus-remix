import { describe, expect, it } from 'vitest';

import { MemoryAgentStore } from '../server/agents/agentStore';
import { AgentRuntimeService, validatePlan } from '../server/agents/agentRuntime';
import { resolveModelProvider, type ModelCallResult, type ModelMessage, type ModelCallOptions } from '../server/agents/modelProvider';
import type { AgentRunRecord, SubtaskSpec } from '../server/agents/types';

function usage(total: number) {
  return { promptTokens: total, completionTokens: 0, totalTokens: total, costUsd: 0 };
}

interface ScriptConf { text?: string; fail?: string; delayMs?: number; tokens?: number; }
type ScriptFn = (messages: ModelMessage[], callIndex: number, opts?: ModelCallOptions) => ScriptConf;

function isReviewerCall(messages: ModelMessage[]): boolean {
  return String(messages[0]?.content || '').includes('final reviewer');
}

/** Fake model caller: deterministic, records call order/concurrency, honors abort signals. */
function makeRuntime(script?: ScriptFn) {
  const store = new MemoryAgentStore();
  const calls: Array<{ messages: ModelMessage[]; startOrder: number; doneOrder: number }> = [];
  let started = 0;
  let finished = 0;
  let inFlight = 0;
  let maxConcurrent = 0;
  const caller = async (messages: ModelMessage[], opts?: ModelCallOptions): Promise<ModelCallResult> => {
    const startOrder = ++started;
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    const idx = calls.length;
    calls.push({ messages, startOrder, doneOrder: -1 });
    const conf = script ? script(messages, idx, opts) : { text: 'SCRIPTED OUTPUT ' + idx };
    if (conf.delayMs) {
      await new Promise<void>((resolve, rejectAbort) => {
        const t = setTimeout(() => resolve(), conf.delayMs as number);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rejectAbort();
        }, { once: true });
      }).catch(() => {
        // Aborted mid-call (timeout or external cancellation).
        inFlight -= 1;
        calls[idx].doneOrder = ++finished;
        throw Object.assign(new Error('ABORTED'), { code: 'ABORTED' });
      });
    }
    inFlight -= 1;
    calls[idx].doneOrder = ++finished;
    if (conf.fail) throw Object.assign(new Error(conf.fail), { code: conf.fail });
    return { content: conf.text ?? 'SCRIPTED OUTPUT ' + idx, usage: usage(conf.tokens ?? 10), modelId: 'fake-model' };
  };
  return { service: new AgentRuntimeService(store, caller), store, calls, maxConcurrent: () => maxConcurrent };
}

const sub = (id: string, role: SubtaskSpec['role'], instructions: string, dependsOn: string[] = []): SubtaskSpec =>
  ({ id, role, title: id, instructions, dependsOn });

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
    const { service } = makeRuntime();
    const run = await service.createRun('userA', 'Obj', [sub('a', 'research', 'x')]);
    await expect(service.executeRun('userB', run.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await expect(service.executeRun('userA', 'run_missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});

describe('Feature 03: dependency and parallel execution', () => {
  it('passes dependency output to the dependent agent and preserves order', async () => {
    const { service, calls } = makeRuntime((messages, idx) => {
      if (isReviewerCall(messages)) return { text: 'PASS verified', tokens: 0 };
      return { text: 'OUTPUT-' + idx, tokens: 5 };
    });
    const run = await service.createRun('userA', 'Build demo', [
      sub('research', 'research', 'find facts'),
      sub('code', 'coding', 'write code', ['research']),
    ]);
    await service.executeRun('userA', run.runId);
    expect(calls[0].startOrder).toBeLessThan(calls[1].startOrder);
    expect(calls[0].doneOrder).toBeLessThan(calls[1].startOrder); // dependency respected
    const codeInput = calls[1].messages[1].content;
    expect(codeInput).toContain('OUTPUT-0'); // A's real output was passed to B
    expect(codeInput).toContain('write code'); // B's own instructions included
  });

  it('executes independent subtasks in parallel', async () => {
    const { service, maxConcurrent } = makeRuntime((messages) => ({
      text: 'out',
      tokens: 5,
      delayMs: 40,
      ...(isReviewerCall(messages) ? { text: 'PASS ok', tokens: 0, delayMs: 0 } : {}),
    }));
    const run = await service.createRun('userA', 'Two probes', [
      sub('p1', 'analysis', 'a'), sub('p2', 'testing', 'b'),
    ]);
    await service.executeRun('userA', run.runId);
    expect(maxConcurrent()).toBeGreaterThanOrEqual(2);
  });

  it('marks dependents as skipped when a dependency fails', async () => {
    const { service } = makeRuntime((messages, idx) => {
      if (isReviewerCall(messages)) return { text: 'FAIL incomplete', tokens: 0 };
      return idx === 0 ? { fail: 'BOOM_TOKENS' } : { text: 'should not be needed' };
    });
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
    const { service } = makeRuntime((messages, idx) => {
      if (isReviewerCall(messages)) return { text: 'PASS ok', tokens: 0 };
      return { text: 'out ' + idx, tokens: 60 };
    });
    const run = await service.createRun('userA', 'Budget test', [
      sub('a', 'research', 'x'), sub('b', 'coding', 'y', ['a']), sub('c', 'analysis', 'z', ['b']),
    ], { budgets: { maxTokens: 100 } });
    const result = await service.executeRun('userA', run.runId);
    const cResult = result.results.find((r) => r.subtaskId === 'c');
    expect(cResult?.status).toBe('skipped');
    expect(cResult?.error).toBe('SKIPPED_BUDGET_EXCEEDED');
    expect(result.results.find((r) => r.subtaskId === 'a')?.status).toBe('completed');
    expect(result.results.find((r) => r.subtaskId === 'b')?.status).toBe('completed');
    expect(result.totalUsage.totalTokens).toBe(120); // a + b ran; c skipped
  });

  it('marks an agent as timed out without fabricating output', async () => {
    const { service } = makeRuntime((messages) => ({
      text: 'late', tokens: 5, delayMs: 3000,
      ...(isReviewerCall(messages) ? { text: 'PASS ok', tokens: 0, delayMs: 0 } : {}),
    }));
    const run = await service.createRun('userA', 'Timeout test', [sub('slow', 'research', 'x')], { budgets: { timeoutSeconds: 1 } });
    const result = await service.executeRun('userA', run.runId);
    const slow = result.results.find((r) => r.subtaskId === 'slow');
    expect(slow?.status).toBe('failed');
    expect(slow?.error).toBe('AGENT_TIMEOUT');
    expect(slow?.output).toBe('');
  });

  it('honours a pre-cancelled run and cancels all pending subtasks', async () => {
    const { service } = makeRuntime();
    const run = await service.createRun('userA', 'Cancel test', [sub('a', 'research', 'x'), sub('b', 'coding', 'y')]);
    await service.cancelRun('userA', run.runId);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('cancelled');
    expect(result.results.every((r) => r.status === 'cancelled')).toBe(true);
  });
});

describe('Feature 03: reviewer gate and usage accounting', () => {
  it('requires a PASS from the final reviewer to complete the run', async () => {
    const { service } = makeRuntime((messages) => {
      if (isReviewerCall(messages)) return { text: 'FAIL objective not met', tokens: 5 };
      return { text: 'work output', tokens: 5 };
    });
    const run = await service.createRun('userA', 'Review test', [sub('a', 'research', 'x')]);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('REVIEWER_REJECTED');
    expect(result.reviewer?.passed).toBe(false);
    expect(result.reviewer?.output).toContain('FAIL');
  });

  it('completes when the reviewer passes and accumulates real usage', async () => {
    const { service } = makeRuntime((messages) => {
      if (isReviewerCall(messages)) return { text: 'PASS verified against the objective', tokens: 7 };
      return { text: 'work output', tokens: 11 };
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
    const { service } = makeRuntime((messages) => {
      if (isReviewerCall(messages)) return { fail: 'MODEL_PROVIDER_UNAVAILABLE' };
      return { text: 'work output', tokens: 5 };
    });
    const run = await service.createRun('userA', 'Reviewer outage test', [sub('a', 'research', 'x')]);
    const result = await service.executeRun('userA', run.runId);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('REVIEWER_UNAVAILABLE');
  });
});
