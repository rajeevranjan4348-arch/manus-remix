import { describe, it, expect } from 'vitest';
import { aiEvaluation } from '../src/lib/aiEvaluation';

describe('AI Evaluation & Regression Test Suite', () => {
  it('runs all automated evaluation cases and passes without regressions', async () => {
    const report = await aiEvaluation.runSuite();
    if (report.failedCount > 0) {
      console.error('FAILED EVAL TESTS:', JSON.stringify(report.results.filter(r => !r.passed), null, 2));
    }
    expect(report.totalTests).toBeGreaterThanOrEqual(7);
    expect(report.failedCount).toBe(0);
    expect(report.passedCount).toBe(report.totalTests);
  });
});
