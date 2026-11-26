import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentRuntimeService,
  AGENT_ROLE_DEFINITIONS,
  DEFAULT_BUDGET,
  validateSubAgentOutput,
  createGeminiModelClient,
  isGeminiModelClientConfigured,
  getGeminiApiKey,
  type AgentModelClient,
  type AgentModelClientRequest,
  type AgentModelClientResponse,
  type SubTaskSpec,
} from '../server/agentRuntime/agentRuntime';
import { InMemoryDurableStore } from '../server/durable/store';

const ALL_ROLES = Object.keys(AGENT_ROLE_DEFINITIONS) as Array<keyof typeof AGENT_ROLE_DEFINITIONS>;

function fakeClient(
  respond: (req: AgentModelClientRequest) => string,
  opts: { delayMs?: number; usage?: { promptTokens: number; completionTokens: number } } = {},
): AgentModelClient & { calls: AgentModelClientRequest[] } {
  const calls: AgentModelClientRequest[] = [];
  const client = (async (req: AgentModelClientRequest) => {
    calls.push(req);
    if (opts.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, opts.delayMs!);
        req.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    }
    const text = respond(req);
    const usage = opts.usage ?? { promptTokens: 100, completionTokens: 50 };
    const response: AgentModelClientResponse = {
      text,
      model: req.model,
      provider: 'fake',
      usage: { ...usage, totalTokens: usage.promptTokens + usage.completionTokens, source: 'provider' },
    };
    return response;
  }) as AgentModelClient & { calls: AgentModelClientRequest[] };
  (client as any).calls = calls;
  return client;
}

const VALID_OUTPUT = 'This deliverable is complete: analysis summary with concrete findings and a final recommendation.';

describe('Feature 03: True autonomous multi-agent runtime', () => {
  let runtime: AgentRuntimeService;

  beforeEach(() => {
    runtime = new AgentRuntimeService(new InMemoryDurableStore());
  });

  it('defines all nine required agent roles with scoped instructions', () => {
    expect(ALL_ROLES.sort()).toEqual(
      [
        'browser',
        'coding',
        'debugging',
        'documentation',
        'qa',
        'research',
        'security_review',
        'testing',
        'analysis',
      ].sort(),
    );
    for (const role of ALL_ROLES) {
      const def = AGENT_ROLE_DEFINITIONS[role];
      expect(def.systemInstruction.length).toBeGreaterThan(20);
      expect(def.defaultModel).toBeTruthy();
      expect(Array.isArray(def.allowedTools)).toBe(true);
    }
  });

  it('executes a real provider-backed run and aggregates provider usage', async () => {
    const client = fakeClient(() => VALID_OUTPUT, { usage: { promptTokens: 120, completionTokens: 80 } });
    const result = await runtime.execute(
      {
        userId: 'usr_a',
        objective: 'Analyze the repository layout',
        subTaskPlan: [
          { id: 's1', role: 'research', goal: 'Map the repository' },
          { id: 's2', role: 'analysis', goal: 'Analyze structure' },
        ],
      },
      client,
    );
    expect(result.status).toBe('completed');
    expect(client.calls).toHaveLength(3);
    expect(result.totals.totalTokens).toBe(600);
    expect(result.totals.usageSource).toBe('provider');
    expect(result.evidence).toHaveLength(2);
    expect(result.reviewerOutput).toBeTruthy();
    expect(result.reviewerRun!.role).toBe('qa');
  });

  it('gives each agent a separate context: role system instruction and dependent handoff', async () => {
    const client = fakeClient(() => VALID_OUTPUT);
    await runtime.execute(
      {
        userId: 'usr_a',
        objective: 'Build feature',
        subTaskPlan: [
          { id: 's1', role: 'research', goal: 'Research approach' },
          { id: 's2', role: 'coding', goal: 'Implement it', dependsOn: ['s1'] },
        ],
      },
      client,
    );
    const researchCall = client.calls.find((c) => c.role === 'research')!;
    const codingCall = client.calls.find((c) => c.role === 'coding')!;
    expect(researchCall.systemInstruction).toBe(AGENT_ROLE_DEFINITIONS.research.systemInstruction);
    expect(codingCall.systemInstruction).toBe(AGENT_ROLE_DEFINITIONS.coding.systemInstruction);
    expect(codingCall.prompt).not.toBe(researchCall.prompt);
    expect(codingCall.prompt).toContain('Result from s1 (research)');
  });

  it('runs independent tasks in parallel and sequential tasks after dependencies', async () => {
    const client = fakeClient(() => VALID_OUTPUT, { delayMs: 60 });
    const seq: string[] = [];
    const parallel = fakeClient((req) => {
      return VALID_OUTPUT;
    }, { delayMs: 50 });
    const result = await runtime.execute(
      {
        userId: 'usr_a',
        objective: 'Parallel research',
        subTaskPlan: [
          { id: 'p1', role: 'research', goal: 'Parallel A' },
          { id: 'p2', role: 'research', goal: 'Parallel B' },
          { id: 'seq1', role: 'analysis', goal: 'Sequential after', dependsOn: ['p1', 'p2'] },
        ],
      },
      parallel,
    );
    expect(result.status).toBe('completed');
    const p1At = parallel.calls.findIndex((c) => c.prompt.includes('Parallel A'));
    const p2At = parallel.calls.findIndex((c) => c.prompt.includes('Parallel B'));
    const seqAt = parallel.calls.findIndex((c) => c.prompt.includes('Sequential after'));
    expect(p1At).toBeGreaterThanOrEqual(0);
    expect(p2At).toBeGreaterThanOrEqual(0);
    expect(Math.abs(p1At - p2At)).toBeLessThanOrEqual(1);
    expect(seqAt).toBe(parallel.calls.length - 2);
  });

  it('enforces the agent-count budget', async () => {
    const client = fakeClient(() => VALID_OUTPUT);
    await expect(
      runtime.execute(
        {
          userId: 'usr_a',
          objective: 'Too many agents',
          subTaskPlan: Array.from({ length: DEFAULT_BUDGET.maxAgents + 1 }, (_, i) => ({
            id: `t${i}`,
            role: 'research' as const,
            goal: `Task ${i}`,
          })),
          budget: { maxAgents: 3 },
        },
        client,
      ),
    ).rejects.toThrow(/budget caps at 3/);
    expect(client.calls).toHaveLength(0);
  });

  it('blocks remaining work with blocked_budget when the token budget is exhausted', async () => {
    const client = fakeClient(() => VALID_OUTPUT, { usage: { promptTokens: 500, completionTokens: 500 } });
    const result = await runtime.execute(
      {
        userId: 'usr_a',
        objective: 'Budget-limited mission',
        subTaskPlan: [
          { id: 'a', role: 'research', goal: 'First task' },
          { id: 'b', role: 'research', goal: 'Second task' },
        ],
        budget: { maxTotalTokens: 1000, maxAgents: 4, maxConcurrency: 1 },
      },
      client,
    );
    const statuses = result.subTaskResults.map((r) => r.status);
    expect(statuses).toContain('completed');
    expect(statuses).toContain('blocked_budget');
    expect(result.status).toBe('partial');
  });

  it('marks an agent as failed when the per-agent timeout aborts the model call', async () => {
    const never = (async (req: AgentModelClientRequest) => {
      return new Promise<AgentModelClientResponse>((resolve, reject) => {
        req.signal.addEventListener('abort', () => reject(new Error(`aborted: ${req.role}`)));
      });
    }) as unknown as AgentModelClient;
    const result = await runtime.execute(
      {
        userId: 'usr_a',
        objective: 'Hangs forever',
        subTaskPlan: [{ id: 's1', role: 'research', goal: 'Research something' }],
        budget: { perAgentTimeoutMs: 60 },
      },
      never,
    );
    expect(result.status).toBe('failed');
    expect(result.subTaskResults[0].status).toBe('failed');
    expect(result.subTaskResults[0].runRecord.error).toBeTruthy();
  }, 10_000);

  it('returns dependency failures instead of executing work downstream of a failed task', async () => {
    let researchCalls = 0;
    const client = fakeClient((req) => {
      if (req.role === 'research') {
        researchCalls += 1;
        return '';
      }
      return VALID_OUTPUT;
    });
    const result = await runtime.execute(
      {
        userId: 'usr_a',
        objective: 'Chain with failure',
        subTaskPlan: [
          { id: 'root', role: 'research', goal: 'Root research' },
          { id: 'leaf', role: 'coding', goal: 'Downstream implementation', dependsOn: ['root'] },
        ],
        budget: { maxCorrectionRounds: 1 },
      },
      client,
    );
    const root = result.subTaskResults.find((r) => r.subTaskId === 'root')!;
    expect(root.status).toBe('failed');
    const leaf = result.subTaskResults.find((r) => r.subTaskId === 'leaf')!;
    expect(leaf.status).toBe('failed');
    expect(leaf.runRecord.error).toContain('Dependency failure');
    expect(client.calls.some((c) => c.role === 'coding')).toBe(false);
    expect(researchCalls).toBe(2);
  });

  it('never fabricates results: unavailable provider usage is reported honestly', async () => {
    expect(() => createGeminiModelClient('')).not.toThrow();

    const client = fakeClient(() => VALID_OUTPUT);
    const hardcoded = (client as unknown as { calls: AgentModelClientRequest[] }).calls;
    expect(hardcoded).toHaveLength(0);
    const result = await runtime.execute(
      {
        userId: 'usr_honest',
        objective: 'Unknown usage',
        subTaskPlan: [{ id: 's1', role: 'research', goal: 'Research something' }],
      },
      (async (req: AgentModelClientRequest) => ({
        text: VALID_OUTPUT,
        model: req.model,
        provider: 'google',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'unavailable' as const },
      })) as AgentModelClient,
    );
    expect(result.totals.usageSource).toBe('unavailable');
    expect(result.totals.totalTokens).toBe(0);
  });

  it('rejects placeholder or empty outputs through validation', () => {
    const spec: SubTaskSpec = { id: 'x', role: 'coding', goal: 'Write a full module with real implementation code' };
    expect(validateSubAgentOutput(spec, '').passed).toBe(false);
    expect(validateSubAgentOutput(spec, 'lorem ipsum').passed).toBe(false);
    expect(validateSubAgentOutput(spec, 'const x = { a: 1 }; // real code artifact').passed).toBe(true);
  });

  it('records run data in the durable store (no fabricated token counts)', async () => {
    const store = new InMemoryDurableStore();
    const rt = new AgentRuntimeService(store);
    const client = fakeClient(() => VALID_OUTPUT);
    await rt.execute(
      {
        userId: 'usr_runs',
        objective: 'Persist runs',
        subTaskPlan: [{ id: 's1', role: 'documentation', goal: 'Write docs' }],
      },
      client,
    );
    const runs = await store.query('system_agent_runs', {});
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const run = runs.find((r) => (r as any).role === 'documentation') as any;
    expect(run.status).toBe('completed');
    expect(run.totalTokens).toBe(150);
    expect(run.usageSource).toBe('provider');
  });
});
