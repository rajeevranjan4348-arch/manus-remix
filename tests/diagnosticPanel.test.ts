import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  estimateTokens, 
  formatTokenCount, 
  computeConversationDiagnostics,
  getActiveTaskDiagnostics 
} from '../src/lib/diagnosticsService';
import { chatAutoSave } from '../src/lib/chatAutoSave';

describe('Diagnostic Panel & Conversation Telemetry Suite', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    vi.restoreAllMocks();
  });

  describe('1. Token Estimation & Formatting', () => {
    it('returns 0 for empty or whitespace-only inputs', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('   \t\n  ')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it('estimates tokens with realistic heuristics for typical conversational queries', () => {
      const text = 'Build a full stack Next.js dashboard with PostgreSQL and Tailwind CSS.';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(35);
    });

    it('accounts for symbol and syntax density in code blocks', () => {
      const code = `function calculateTotal(items: { price: number; qty: number }[]): number {
  return items.reduce((acc, curr) => acc + (curr.price * curr.qty), 0);
}`;
      const tokens = estimateTokens(code);
      expect(tokens).toBeGreaterThan(25);
    });

    it('formats token numbers cleanly into human-readable strings', () => {
      expect(formatTokenCount(350)).toBe('350');
      expect(formatTokenCount(4520)).toBe('4,520');
      expect(formatTokenCount(15600)).toBe('15.6K');
      expect(formatTokenCount(2097152)).toBe('2.1M');
      expect(formatTokenCount(1000000)).toBe('1M');
    });
  });

  describe('2. Conversation Turns & Exchange Statistics', () => {
    it('computes 0 turns when no task or messages are present', () => {
      const diag = computeConversationDiagnostics({});
      expect(diag.turns.total).toBe(0);
      expect(diag.turns.user).toBe(0);
      expect(diag.turns.assistant).toBe(0);
      expect(diag.turns.cycles).toBe(0);
      expect(diag.hasActiveTask).toBe(false);
    });

    it('accurately counts user, assistant, and total conversation turns', () => {
      const diag = computeConversationDiagnostics({
        taskId: 'task-diag-101',
        prompt: 'Initial query',
        messages: [
          { role: 'user', content: 'What is quantum computing?' },
          { role: 'assistant', content: 'Quantum computing harnesses quantum mechanics to perform complex calculations.' },
          { role: 'user', content: 'How does it compare to classical supercomputers?' },
          { role: 'assistant', content: 'Classical computers use bits (0 or 1), while quantum computers use qubits.' },
        ],
        status: 'completed',
      });

      expect(diag.turns.total).toBe(4);
      expect(diag.turns.user).toBe(2);
      expect(diag.turns.assistant).toBe(2);
      expect(diag.turns.cycles).toBe(2);
      expect(diag.taskStatus).toBe('completed');
      expect(diag.hasActiveTask).toBe(true);
    });

    it('computes dialogue cycles for multi-turn conversations', () => {
      const diag = computeConversationDiagnostics({
        taskId: 'task-multi-turn',
        messages: [
          { role: 'user', content: 'Turn 1 user' },
          { role: 'assistant', content: 'Turn 1 assistant' },
          { role: 'user', content: 'Turn 2 user' },
          { role: 'assistant', content: 'Turn 2 assistant' },
          { role: 'user', content: 'Turn 3 user (unanswered)' },
        ],
        status: 'running',
      });

      expect(diag.turns.total).toBe(5);
      expect(diag.turns.user).toBe(3);
      expect(diag.turns.assistant).toBe(2);
      expect(diag.turns.cycles).toBe(2);
      expect(diag.taskStatus).toBe('running');
    });
  });

  describe('3. Estimated Token Counts & Context Window Telemetry', () => {
    it('accurately distributes tokens across user, assistant, and tools', () => {
      const diag = computeConversationDiagnostics({
        taskId: 'task-tokens-test',
        prompt: 'Analyze server latency',
        messages: [
          { role: 'user', content: 'Analyze the API latency across 5 regional clusters.' },
          { role: 'assistant', content: 'Here is the benchmark summary: US-East: 24ms, EU-Central: 38ms, AP-South: 45ms.' },
        ],
        steps: [
          { label: 'Fetching latency logs', trace: ['pinging clusters', 'computing p99'] },
          { label: 'Formatting diagnostic report', trace: ['generating charts'] },
        ],
        selectedModelId: 'gemini-3.8-flash',
      });

      expect(diag.tokens.userTokens).toBeGreaterThan(0);
      expect(diag.tokens.assistantTokens).toBeGreaterThan(0);
      expect(diag.tokens.toolTokens).toBeGreaterThan(0);
      expect(diag.tokens.totalTokens).toBe(
        diag.tokens.userTokens + diag.tokens.assistantTokens + diag.tokens.systemTokens + diag.tokens.toolTokens
      );
      expect(diag.metrics.totalCharacters).toBeGreaterThan(50);
      expect(diag.metrics.totalWords).toBeGreaterThan(10);
      expect(diag.metrics.averageTokensPerTurn).toBeGreaterThan(0);
    });

    it('computes 2 Million context window metrics for 2M models', () => {
      const diag = computeConversationDiagnostics({
        taskId: 'task-2m-context',
        prompt: 'Ingest huge repository',
        messages: [
          { role: 'user', content: 'Review the entire 500-file repository for security flaws.' },
          { role: 'assistant', content: 'Analyzing all 500 modules within the 2 Million context window.' },
        ],
        selectedModelId: 'gemini-3.1-pro-preview',
      });

      expect(diag.contextWindowMax).toBe(2097152); // 2 Million tokens
      expect(diag.metrics.is2MContext).toBe(true);
      expect(diag.metrics.remainingTokens).toBe(2097152 - diag.tokens.totalTokens);
      expect(diag.metrics.contextUsagePercent).toBeLessThan(1.0); // low percentage of 2M
    });
  });

  describe('4. Active Task Fallback from Autosave Snapshot', () => {
    it('restores telemetry from active autosave snapshot when no props are provided', () => {
      vi.spyOn(chatAutoSave, 'getSnapshot').mockReturnValue({
        taskId: 'snapshot-task-99',
        prompt: 'Build landing page',
        mode: 'chat',
        status: 'completed',
        messages: [
          { id: '1', role: 'user', content: 'Design a high-converting hero section', timestamp: new Date().toISOString() },
          { id: '2', role: 'assistant', content: 'Here is the hero section with call-to-actions', timestamp: new Date().toISOString() },
        ],
        steps: [{ id: 's1', label: 'Compiling components', status: 'completed' }],
        lastSavedAt: new Date().toISOString(),
        version: 1,
      });

      const diag = getActiveTaskDiagnostics();
      expect(diag.hasActiveTask).toBe(true);
      expect(diag.taskId).toBe('snapshot-task-99');
      expect(diag.turns.total).toBe(2);
      expect(diag.turns.user).toBe(1);
      expect(diag.turns.assistant).toBe(1);
      expect(diag.tokens.totalTokens).toBeGreaterThan(10);
    });
  });
});
