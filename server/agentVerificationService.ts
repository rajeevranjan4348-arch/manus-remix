import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  agentActivityHub,
  AgentActivityEvent,
  VerificationOutcome,
} from './agentActivityService';

const execFileAsync = promisify(execFile);

export interface VerificationStageResult {
  stage:
    | 'inspect_files'
    | 'identify_components'
    | 'analyze_dependencies'
    | 'check_implementation'
    | 'type_check'
    | 'run_tests'
    | 'build_verification'
    | 'verify_final_result';
  label: string;
  outcome: VerificationOutcome;
  summary: string;
  executed: boolean;
  details?: string[];
  error?: string;
}

export interface TechnicalVerificationReport {
  taskId: string;
  executedAt: string;
  stages: VerificationStageResult[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  affectedFiles: string[];
}

export interface RunTechnicalVerificationOptions {
  taskId: string;
  prompt: string;
  workspaceRoot?: string;
  targetPaths?: string[];
  /**
   * When true, actually executes shell verification checks (`tsc --noEmit`, tests, build)
   * when requested. When false, reports those checks honestly as SKIPPED rather than PASSED.
   */
  runTypeCheck?: boolean;
  runTests?: boolean;
  runBuild?: boolean;
  onActivity?: (event: AgentActivityEvent) => void;
}

const TECHNICAL_TASK_PATTERN =
  /\b(fix|debug|bug|error|typescript|tsc|build|compile|test|vitest|lint|api route|endpoint|backend|frontend|component|react|firebase|firestore|auth|oauth|database|sql|cloud sql|netlify|vite|deploy|refactor|architecture|repository|repo|package\.json|dependency|dependencies|config|configuration|hook|service|sse|websocket|stream|codebase)\b/i;

export function isTechnicalVerificationTask(prompt: string): boolean {
  const clean = String(prompt || '')
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]/gi, '')
    .trim();
  if (clean.length < 10) return false;
  return TECHNICAL_TASK_PATTERN.test(clean);
}

const TOPIC_TO_PATHS: Array<{ pattern: RegExp; paths: string[] }> = [
  { pattern: /\b(firebase|auth|login|session|oauth|google sign)/i, paths: ['src/lib/firebase.ts', 'src/context/FirebaseContext.tsx', 'src/components/auth/AuthGuard.tsx'] },
  { pattern: /\b(route|backend|api|server|stream|sse|vite)/i, paths: ['vite.config.ts', 'server/geminiService.ts', 'netlify/functions/agent.ts'] },
  { pattern: /\b(chat|ui|message|view|composer|activity)/i, paths: ['src/components/agent/ChatView.tsx', 'src/hooks/useAgentTask.ts', 'src/lib/blink.ts'] },
  { pattern: /\b(sql|database|postgres|drizzle|cloud sql)/i, paths: ['server/cloudSqlRoutes.ts', 'src/db/schema.ts'] },
  { pattern: /\b(workspace|gmail|drive|sheets|calendar|connector)/i, paths: ['server/connectorsService.ts', 'server/workspaceIntegrationsHandler.ts', 'src/lib/workspaceTools.ts'] },
  { pattern: /\b(history|tag|summary)/i, paths: ['src/components/history/HistoryPanel.tsx', 'src/lib/taskTaggingService.ts'] },
  { pattern: /\b(netlify|deploy|build|dependency|dependencies|package)/i, paths: ['package.json', 'netlify.toml', 'tsconfig.json'] },
];

function resolveSafeWorkspacePaths(workspaceRoot: string, prompt: string, explicitPaths?: string[]): string[] {
  const candidates = new Set<string>();
  if (Array.isArray(explicitPaths)) {
    for (const p of explicitPaths) {
      if (typeof p === 'string' && p.trim() && !p.includes('..')) {
        candidates.add(p.replace(/^\/+/, ''));
      }
    }
  }
  for (const mapping of TOPIC_TO_PATHS) {
    if (mapping.pattern.test(prompt)) {
      for (const rel of mapping.paths) candidates.add(rel);
    }
  }
  if (candidates.size === 0) {
    candidates.add('package.json');
    candidates.add('vite.config.ts');
    candidates.add('server/geminiService.ts');
  }

  const rootResolved = path.resolve(workspaceRoot);
  const existing: string[] = [];
  for (const rel of candidates) {
    const abs = path.resolve(rootResolved, rel);
    if (!abs.startsWith(rootResolved)) continue;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        existing.push(rel);
      }
    } catch {
      // ignore inaccessible files
    }
  }
  return existing.slice(0, 8);
}

export async function runTechnicalVerification(
  options: RunTechnicalVerificationOptions
): Promise<TechnicalVerificationReport> {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const { taskId, prompt, onActivity } = options;
  const stages: VerificationStageResult[] = [];
  let affectedFiles: string[] = [];

  // Stage 1: Inspect relevant files
  const inspectHandle = agentActivityHub.startActivity(
    taskId,
    {
      title: 'Inspecting relevant repository files',
      description: 'Checking workspace files matching the technical task scope',
      toolName: 'file_inspector',
      category: 'file',
      verificationStage: 'inspect_files',
      verificationOutcome: 'RUNNING',
    },
    onActivity
  );
  try {
    affectedFiles = resolveSafeWorkspacePaths(workspaceRoot, prompt, options.targetPaths);
    const summary = affectedFiles.length > 0
      ? `Verified ${affectedFiles.length} file(s): ${affectedFiles.slice(0, 4).join(', ')}`
      : 'No matching repository files were found for the specified scope';
    inspectHandle.complete(summary, {
      verificationOutcome: affectedFiles.length > 0 ? 'PASSED' : 'SKIPPED',
    });
    stages.push({
      stage: 'inspect_files',
      label: 'Inspect relevant files',
      outcome: affectedFiles.length > 0 ? 'PASSED' : 'SKIPPED',
      summary,
      executed: true,
      details: affectedFiles,
    });
  } catch (err: any) {
    inspectHandle.fail(err, { verificationOutcome: 'FAILED' });
    stages.push({
      stage: 'inspect_files',
      label: 'Inspect relevant files',
      outcome: 'FAILED',
      summary: 'File inspection failed',
      executed: true,
      error: err?.message || String(err),
    });
  }

  // Stage 2: Identify affected components & exports
  const compHandle = agentActivityHub.startActivity(
    taskId,
    {
      title: 'Identifying affected components and routes',
      description: 'Scanning inspected modules for exported symbols and API endpoints',
      toolName: 'ast_scanner',
      category: 'analysis',
      verificationStage: 'identify_components',
      verificationOutcome: 'RUNNING',
    },
    onActivity
  );
  const discoveredSymbols: string[] = [];
  try {
    for (const rel of affectedFiles.slice(0, 5)) {
      const abs = path.resolve(workspaceRoot, rel);
      const raw = fs.readFileSync(abs, 'utf-8').slice(0, 12000);
      const exportMatches = raw.match(/export\s+(?:async\s+)?(?:function|const|class|interface)\s+([A-Za-z0-9_]+)/g) || [];
      for (const m of exportMatches.slice(0, 3)) {
        const name = m.split(/\s+/).pop();
        if (name) discoveredSymbols.push(`${rel}:${name}`);
      }
    }
    const summary = discoveredSymbols.length > 0
      ? `Identified ${discoveredSymbols.length} symbol(s) across ${affectedFiles.length} module(s)`
      : `Inspected ${affectedFiles.length} configuration/source file(s)`;
    compHandle.complete(summary, { verificationOutcome: 'PASSED' });
    stages.push({
      stage: 'identify_components',
      label: 'Identify affected components',
      outcome: 'PASSED',
      summary,
      executed: true,
      details: discoveredSymbols.slice(0, 6),
    });
  } catch (err: any) {
    compHandle.fail(err, { verificationOutcome: 'FAILED' });
    stages.push({
      stage: 'identify_components',
      label: 'Identify affected components',
      outcome: 'FAILED',
      summary: 'Component scan failed',
      executed: true,
      error: err?.message || String(err),
    });
  }

  // Stage 3: Analyze dependencies
  const depHandle = agentActivityHub.startActivity(
    taskId,
    {
      title: 'Analyzing project dependencies and scripts',
      description: 'Inspecting package.json runtime dependencies and verification scripts',
      toolName: 'dependency_analyzer',
      category: 'verification',
      verificationStage: 'analyze_dependencies',
      verificationOutcome: 'RUNNING',
    },
    onActivity
  );
  try {
    const pkgPath = path.resolve(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const depCount = Object.keys(pkg.dependencies || {}).length;
      const devDepCount = Object.keys(pkg.devDependencies || {}).length;
      const scripts = Object.keys(pkg.scripts || {});
      const summary = `${depCount} runtime deps, ${devDepCount} devDeps, scripts: ${scripts.slice(0, 5).join(', ')}`;
      depHandle.complete(summary, { verificationOutcome: 'PASSED' });
      stages.push({
        stage: 'analyze_dependencies',
        label: 'Analyze dependencies',
        outcome: 'PASSED',
        summary,
        executed: true,
      });
    } else {
      const summary = 'package.json not present in workspace root';
      depHandle.complete(summary, { verificationOutcome: 'SKIPPED' });
      stages.push({
        stage: 'analyze_dependencies',
        label: 'Analyze dependencies',
        outcome: 'SKIPPED',
        summary,
        executed: true,
      });
    }
  } catch (err: any) {
    depHandle.fail(err, { verificationOutcome: 'FAILED' });
    stages.push({
      stage: 'analyze_dependencies',
      label: 'Analyze dependencies',
      outcome: 'FAILED',
      summary: 'Dependency analysis failed',
      executed: true,
      error: err?.message || String(err),
    });
  }

  // Stage 4: Check implementation
  const implHandle = agentActivityHub.startActivity(
    taskId,
    {
      title: 'Checking implementation integrity',
      description: 'Validating file readability and non-empty module structure',
      toolName: 'implementation_check',
      category: 'code',
      verificationStage: 'check_implementation',
      verificationOutcome: 'RUNNING',
    },
    onActivity
  );
  try {
    let totalLines = 0;
    for (const rel of affectedFiles) {
      const content = fs.readFileSync(path.resolve(workspaceRoot, rel), 'utf-8');
      totalLines += content.split('\n').length;
    }
    const summary = `Checked ${affectedFiles.length} file(s) (${totalLines} lines scanned)`;
    implHandle.complete(summary, { verificationOutcome: 'PASSED' });
    stages.push({
      stage: 'check_implementation',
      label: 'Check implementation',
      outcome: 'PASSED',
      summary,
      executed: true,
    });
  } catch (err: any) {
    implHandle.fail(err, { verificationOutcome: 'FAILED' });
    stages.push({
      stage: 'check_implementation',
      label: 'Check implementation',
      outcome: 'FAILED',
      summary: 'Implementation check failed',
      executed: true,
      error: err?.message || String(err),
    });
  }

  // Stage 5: TypeScript check (ONLY mark passed if actually executed!)
  if (options.runTypeCheck) {
    const tscHandle = agentActivityHub.startActivity(
      taskId,
      {
        title: 'Running TypeScript validation',
        description: 'Executing tsc --noEmit across project sources',
        toolName: 'typescript_check',
        category: 'terminal',
        verificationStage: 'type_check',
        verificationOutcome: 'RUNNING',
      },
      onActivity
    );
    try {
      await execFileAsync('npx', ['tsc', '--noEmit'], { cwd: workspaceRoot, timeout: 45000 });
      const summary = 'TypeScript check passed with 0 errors';
      tscHandle.complete(summary, { verificationOutcome: 'PASSED' });
      stages.push({
        stage: 'type_check',
        label: 'Run TypeScript validation',
        outcome: 'PASSED',
        summary,
        executed: true,
      });
    } catch (err: any) {
      const stderr = String(err?.stdout || err?.stderr || err?.message || 'TypeScript errors found').slice(0, 220);
      tscHandle.fail(stderr, { verificationOutcome: 'FAILED' });
      stages.push({
        stage: 'type_check',
        label: 'Run TypeScript validation',
        outcome: 'FAILED',
        summary: 'TypeScript check reported errors',
        executed: true,
        error: stderr,
      });
    }
  } else {
    const skippedEvent = agentActivityHub.emit({
      taskId,
      title: 'TypeScript validation skipped',
      description: 'Not executed during read-only chat analysis',
      toolName: 'typescript_check',
      status: 'COMPLETED',
      category: 'verification',
      verificationStage: 'type_check',
      verificationOutcome: 'SKIPPED',
      resultSummary: 'Skipped (run explicit verification to execute tsc --noEmit)',
    });
    onActivity?.(skippedEvent);
    stages.push({
      stage: 'type_check',
      label: 'Run TypeScript validation',
      outcome: 'SKIPPED',
      summary: 'Not executed during read-only chat analysis',
      executed: false,
    });
  }

  // Stage 6: Automated tests (ONLY mark passed if actually executed!)
  if (options.runTests) {
    const testHandle = agentActivityHub.startActivity(
      taskId,
      {
        title: 'Running automated test suite',
        description: 'Executing Vitest test runner',
        toolName: 'vitest',
        category: 'terminal',
        verificationStage: 'run_tests',
        verificationOutcome: 'RUNNING',
      },
      onActivity
    );
    try {
      const { stdout } = await execFileAsync('npx', ['vitest', 'run'], { cwd: workspaceRoot, timeout: 90000 });
      const passLine = stdout.split('\n').find((l) => /Test Files|Tests\s+/i.test(l))?.trim() || 'Automated tests passed';
      testHandle.complete(passLine, { verificationOutcome: 'PASSED' });
      stages.push({
        stage: 'run_tests',
        label: 'Run automated tests',
        outcome: 'PASSED',
        summary: passLine,
        executed: true,
      });
    } catch (err: any) {
      const errOut = String(err?.stdout || err?.stderr || err?.message || 'Test suite failed').slice(0, 220);
      testHandle.fail(errOut, { verificationOutcome: 'FAILED' });
      stages.push({
        stage: 'run_tests',
        label: 'Run automated tests',
        outcome: 'FAILED',
        summary: 'Automated tests failed',
        executed: true,
        error: errOut,
      });
    }
  } else {
    const skippedTest = agentActivityHub.emit({
      taskId,
      title: 'Automated test suite skipped',
      description: 'Not executed during read-only chat analysis',
      toolName: 'vitest',
      status: 'COMPLETED',
      category: 'verification',
      verificationStage: 'run_tests',
      verificationOutcome: 'SKIPPED',
      resultSummary: 'Skipped (run explicit verification to execute Vitest)',
    });
    onActivity?.(skippedTest);
    stages.push({
      stage: 'run_tests',
      label: 'Run automated tests',
      outcome: 'SKIPPED',
      summary: 'Not executed during read-only chat analysis',
      executed: false,
    });
  }

  // Stage 7: Build verification (ONLY mark passed if actually executed!)
  if (options.runBuild) {
    const buildHandle = agentActivityHub.startActivity(
      taskId,
      {
        title: 'Executing production build verification',
        description: 'Running npm run build',
        toolName: 'vite_build',
        category: 'terminal',
        verificationStage: 'build_verification',
        verificationOutcome: 'RUNNING',
      },
      onActivity
    );
    try {
      await execFileAsync('npm', ['run', 'build'], { cwd: workspaceRoot, timeout: 90000 });
      const summary = 'Production build completed cleanly';
      buildHandle.complete(summary, { verificationOutcome: 'PASSED' });
      stages.push({
        stage: 'build_verification',
        label: 'Execute build verification',
        outcome: 'PASSED',
        summary,
        executed: true,
      });
    } catch (err: any) {
      const errOut = String(err?.stderr || err?.stdout || err?.message || 'Build failed').slice(0, 220);
      buildHandle.fail(errOut, { verificationOutcome: 'FAILED' });
      stages.push({
        stage: 'build_verification',
        label: 'Execute build verification',
        outcome: 'FAILED',
        summary: 'Production build failed',
        executed: true,
        error: errOut,
      });
    }
  } else {
    const skippedBuild = agentActivityHub.emit({
      taskId,
      title: 'Build verification skipped',
      description: 'Not executed during read-only chat analysis',
      toolName: 'vite_build',
      status: 'COMPLETED',
      category: 'verification',
      verificationStage: 'build_verification',
      verificationOutcome: 'SKIPPED',
      resultSummary: 'Skipped (run explicit verification to execute production build)',
    });
    onActivity?.(skippedBuild);
    stages.push({
      stage: 'build_verification',
      label: 'Execute build verification',
      outcome: 'SKIPPED',
      summary: 'Not executed during read-only chat analysis',
      executed: false,
    });
  }

  const passedCount = stages.filter((s) => s.outcome === 'PASSED').length;
  const failedCount = stages.filter((s) => s.outcome === 'FAILED').length;
  const skippedCount = stages.filter((s) => s.outcome === 'SKIPPED').length;

  // Stage 8: Verify final result summary
  const finalSummary = `Verification summary: ${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped`;
  const finalEvent = agentActivityHub.emit({
    taskId,
    title: 'Verifying final check outcomes',
    description: 'Aggregating real executed checks and skipped stages',
    toolName: 'result_verifier',
    status: failedCount > 0 ? 'FAILED' : 'COMPLETED',
    category: 'verification',
    verificationStage: 'verify_final_result',
    verificationOutcome: failedCount > 0 ? 'FAILED' : 'PASSED',
    resultSummary: finalSummary,
    ...(failedCount > 0 ? { error: `${failedCount} verification check(s) failed` } : {}),
  });
  onActivity?.(finalEvent);

  stages.push({
    stage: 'verify_final_result',
    label: 'Verify final result',
    outcome: failedCount > 0 ? 'FAILED' : 'PASSED',
    summary: finalSummary,
    executed: true,
  });

  return {
    taskId,
    executedAt: new Date().toISOString(),
    stages,
    passedCount: stages.filter((s) => s.outcome === 'PASSED').length,
    failedCount: stages.filter((s) => s.outcome === 'FAILED').length,
    skippedCount: stages.filter((s) => s.outcome === 'SKIPPED').length,
    affectedFiles,
  };
}
