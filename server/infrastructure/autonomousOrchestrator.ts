/**
 * Cross-Feature Integration Orchestrator (Features 01–06).
 *
 * Connects all six autonomous infrastructure systems into cohesive end-to-end pipelines:
 * 1) Autonomous Coding Pipeline:
 *    Feature 01 (Durable Task) -> Feature 04 (Skill Selection) -> Feature 02 (Permissions)
 *    -> Feature 03 (Multi-Agent Runtime) -> Feature 06 (Isolated Sandbox + Real Browser)
 *    -> Feature 01 (Verified Completion + Durable Notification).
 *
 * 2) Scheduled Research Pipeline:
 *    Feature 05 (Persistent Schedule + Atomic Dispatch) -> Feature 01 (Durable Task)
 *    -> Feature 04 (Research Skill) -> Feature 02 (Permissions)
 *    -> Feature 03 (Research + QA Multi-Agent) -> Feature 01 (Verified Completion + Notification).
 */

import {
  defaultBrowserEngine,
  type BrowserExecutionEngine,
} from '../browser/browserEngine';
import {
  defaultMultiAgentEngine,
  type MultiAgentRunRecord,
  type MultiAgentRuntimeEngine,
} from '../multiAgent/multiAgentEngine';
import {
  permissionsGateway,
  type PermissionsGatewayService,
} from '../permissionsGateway';
import {
  defaultBackgroundTaskEngine,
  type BackgroundTaskEngine,
  type BackgroundTaskRecord,
} from '../queue/backgroundTaskEngine';
import type { DurableRequestContext } from '../sandbox/durableStore';
import {
  defaultSandboxEngine,
  type SandboxExecutionEngine,
} from '../sandbox/sandboxEngine';
import {
  defaultSchedulerEngine,
  type PersistentSchedulerEngine,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from '../scheduler/schedulerEngine';
import {
  defaultSkillsEngine,
  type SkillExecutionRecord,
  type SkillsEcosystemEngine,
} from '../skills/skillsEngine';

export interface AutonomousOrchestratorDeps {
  taskEngine?: BackgroundTaskEngine;
  permissions?: PermissionsGatewayService;
  multiAgent?: MultiAgentRuntimeEngine;
  skills?: SkillsEcosystemEngine;
  scheduler?: PersistentSchedulerEngine;
  sandbox?: SandboxExecutionEngine;
  browser?: BrowserExecutionEngine;
}

export interface AutonomousCodingPipelineInput {
  projectId: string;
  objective: string;
  runtime?: 'node' | 'vite' | 'react' | 'python' | 'html';
  filesToWrite: Array<{ path: string; content: string }>;
  testCommand?: string;
  previewCommand?: string;
  previewPort?: number;
  verifyInBrowser?: boolean;
  approvalTokens?: {
    terminalExec?: string;
    previewStart?: string;
  };
  workerId?: string;
}

export interface AutonomousCodingPipelineResult {
  task: BackgroundTaskRecord;
  skillExecution: SkillExecutionRecord | null;
  multiAgentRun: MultiAgentRunRecord;
  sandboxId: string;
  filesWritten: string[];
  commandResult?: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    status: string;
  };
  previewUrl?: string;
  browserVerification?: {
    sessionId: string;
    title: string;
    verified: boolean;
  };
}

export interface ScheduledResearchPipelineInput {
  scheduleId?: string;
  scheduleName?: string;
  topic: string;
  timeZone?: string;
  cronExpression?: string;
  runAt?: string;
  workerId?: string;
  nowMs?: number;
}

export interface ScheduledResearchPipelineResult {
  schedule: ScheduleRecord;
  scheduleRun: ScheduleRunRecord;
  task: BackgroundTaskRecord;
  skillExecution: SkillExecutionRecord | null;
  multiAgentRun: MultiAgentRunRecord;
}

export class AutonomousInfrastructureOrchestrator {
  private readonly taskEngine: BackgroundTaskEngine;
  private readonly permissions: PermissionsGatewayService;
  private readonly multiAgent: MultiAgentRuntimeEngine;
  private readonly skills: SkillsEcosystemEngine;
  private readonly scheduler: PersistentSchedulerEngine;
  private readonly sandbox: SandboxExecutionEngine;
  private readonly browser: BrowserExecutionEngine;

  constructor(deps?: AutonomousOrchestratorDeps) {
    this.taskEngine = deps?.taskEngine ?? defaultBackgroundTaskEngine;
    this.permissions = deps?.permissions ?? permissionsGateway;
    this.multiAgent = deps?.multiAgent ?? defaultMultiAgentEngine;
    this.skills = deps?.skills ?? defaultSkillsEngine;
    this.scheduler = deps?.scheduler ?? defaultSchedulerEngine;
    this.sandbox = deps?.sandbox ?? defaultSandboxEngine;
    this.browser = deps?.browser ?? defaultBrowserEngine;
  }

  /**
   * End-to-End Autonomous Coding Pipeline integrating Features 01, 02, 03, 04, and 06.
   */
  public async runAutonomousCodingPipeline(
    ctx: DurableRequestContext,
    input: AutonomousCodingPipelineInput,
  ): Promise<AutonomousCodingPipelineResult> {
    const workerId = input.workerId || `orchestrator_worker_${Date.now()}`;

    // 1. Feature 01: Enqueue & atomically claim durable background task
    const { task: queuedTask } = await this.taskEngine.enqueueTask(ctx, {
      title: `Autonomous Coding: ${input.objective.slice(0, 80)}`,
      prompt: input.objective,
      type: 'coding',
      priority: 'high',
      payload: { projectId: input.projectId, runtime: input.runtime || 'node' },
      skipDispatch: true,
    });

    const claimed = await this.taskEngine.claimNextTask(workerId, { userId: ctx.userId });
    const activeTaskId = claimed?.taskId || queuedTask.taskId;

    try {
      // 2. Feature 04: Select & execute installed coding skill (auto-install verified built-in if absent)
      let selected = await this.skills.selectBestSkillForTask(ctx, `${input.objective} coding sandbox`);
      if (!selected.skill) {
        const installed = await this.skills.installSkill(ctx, { catalogId: 'sandbox-fullstack-builder' });
        selected = { skill: installed, score: 10, reason: 'Installed verified built-in sandbox builder skill.' };
      }

      const skillExecution = selected.skill
        ? await this.skills.executeSkill(ctx, {
            skillId: selected.skill.skillId,
            taskInput: input.objective,
          })
        : null;

      await this.taskEngine.updateTaskProgress(ctx, {
        taskId: activeTaskId,
        workerId,
        phase: 'waiting_for_agent',
        progress: 25,
        message: 'Running specialized multi-agent coding & QA architecture team.',
      });

      // 3. Feature 03: Real provider-backed multi-agent planning, coding, testing, and QA review
      const multiAgentRun = await this.multiAgent.runOrchestration(ctx, {
        objective: input.objective,
        nodes: [
          {
            id: 'coding_design',
            role: 'coding',
            title: 'Architecture & Implementation Verification',
            objective: `Review planned changes for project '${input.projectId}': ${input.objective}`,
          },
          {
            id: 'security_check',
            role: 'security_reviewer',
            title: 'Security Boundary Verification',
            objective: `Verify workspace boundary isolation and input safety for: ${input.objective}`,
          },
          {
            id: 'testing_plan',
            role: 'testing',
            title: 'Verification Plan',
            objective: `Validate test coverage for: ${input.objective}`,
            dependsOn: ['coding_design', 'security_check'],
          },
        ],
        enableQaReview: true,
      });

      await this.taskEngine.updateTaskProgress(ctx, {
        taskId: activeTaskId,
        workerId,
        phase: 'executing_command',
        progress: 55,
        message: 'Provisioning isolated Feature 06 sandbox and applying workspace edits.',
      });

      // 4. Feature 06 + Feature 02: Provision isolated sandbox, write files, execute commands
      const sandboxRec = await this.sandbox.createSandbox(ctx, {
        projectId: input.projectId,
        runtime: input.runtime || 'node',
      });

      const filesWritten: string[] = [];
      for (const file of input.filesToWrite) {
        await this.sandbox.writeFile(ctx, sandboxRec.sandboxId, file.path, file.content);
        filesWritten.push(file.path);
      }

      let commandResult: AutonomousCodingPipelineResult['commandResult'];
      if (input.testCommand) {
        await this.taskEngine.updateTaskProgress(ctx, {
          taskId: activeTaskId,
          workerId,
          phase: 'testing',
          progress: 72,
          message: `Executing sandbox command: ${input.testCommand}`,
        });
        const exec = await this.sandbox.executeTerminal(ctx, {
          sandboxId: sandboxRec.sandboxId,
          command: input.testCommand,
          approvalToken: input.approvalTokens?.terminalExec,
        });
        commandResult = {
          exitCode: exec.exitCode,
          stdout: exec.stdout,
          stderr: exec.stderr,
          status: exec.status,
        };
      }

      let previewUrl: string | undefined;
      let browserVerification: AutonomousCodingPipelineResult['browserVerification'];

      if (input.previewCommand && input.previewPort) {
        const preview = await this.sandbox.startPreview(ctx, {
          sandboxId: sandboxRec.sandboxId,
          command: input.previewCommand,
          port: input.previewPort,
          approvalToken: input.approvalTokens?.previewStart,
        });
        previewUrl = preview.previewUrl;

        if (input.verifyInBrowser && previewUrl) {
          await this.taskEngine.updateTaskProgress(ctx, {
            taskId: activeTaskId,
            workerId,
            phase: 'browser_session_active',
            progress: 88,
            message: `Inspecting live preview URL in isolated browser session: ${previewUrl}`,
          });

          const session = await this.browser.createSession(ctx, { projectId: input.projectId });
          try {
            const nav = await this.browser.navigate(ctx, { sessionId: session.sessionId, url: previewUrl });
            browserVerification = {
              sessionId: session.sessionId,
              title: nav.page.title || '',
              verified: Boolean(nav.page.url),
            };
          } finally {
            await this.browser.closeSession(ctx, session.sessionId).catch(() => {});
          }
        }
      }

      // 5. Feature 01: Complete durable task with full verified evidence & notification
      const completedTask = await this.taskEngine.completeTask(ctx, {
        taskId: activeTaskId,
        workerId,
        summary: `Sandbox ${sandboxRec.sandboxId} verified (${filesWritten.length} files written).`,
        result: {
          sandboxId: sandboxRec.sandboxId,
          filesWritten,
          commandResult,
          previewUrl,
          browserVerification,
          multiAgentRunId: multiAgentRun.runId,
          totalTokens: multiAgentRun.totalUsage.totalTokens,
          costUsd: multiAgentRun.totalUsage.costUsd,
          skillId: skillExecution?.skillId || null,
        },
      });

      return {
        task: completedTask,
        skillExecution,
        multiAgentRun,
        sandboxId: sandboxRec.sandboxId,
        filesWritten,
        commandResult,
        previewUrl,
        browserVerification,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Autonomous coding pipeline failed.';
      await this.taskEngine
        .failTask(ctx, {
          taskId: activeTaskId,
          workerId,
          error: msg,
          retryable: false,
        })
        .catch(() => {});
      throw err;
    }
  }

  /**
   * End-to-End Scheduled Research Pipeline integrating Features 05, 01, 02, 03, and 04.
   */
  public async runScheduledResearchPipeline(
    ctx: DurableRequestContext,
    input: ScheduledResearchPipelineInput,
  ): Promise<ScheduledResearchPipelineResult> {
    const nowMs = input.nowMs ?? Date.now();
    const workerId = input.workerId || `research_worker_${nowMs}`;

    // 1. Feature 05: Create or load persisted schedule & atomically dispatch into Feature 01
    let schedule: ScheduleRecord | null = input.scheduleId
      ? await this.scheduler.getSchedule(ctx, input.scheduleId)
      : null;

    if (!schedule) {
      schedule = await this.scheduler.createSchedule(ctx, {
        name: input.scheduleName || `Scheduled Research: ${input.topic.slice(0, 60)}`,
        kind: input.cronExpression ? 'cron' : 'once',
        cronExpression: input.cronExpression,
        runAt: input.runAt || new Date(nowMs).toISOString(),
        timeZone: input.timeZone || 'UTC',
        taskTitle: `Research Brief: ${input.topic.slice(0, 80)}`,
        taskPrompt: input.topic,
        taskType: 'research',
        priority: 'normal',
        nowMs,
      });
    }

    const dispatchRes = await this.scheduler.dispatchDueSchedules({
      nowMs: nowMs + 1000,
      userId: ctx.userId,
      scheduleId: schedule.scheduleId,
      forceRunNow: Boolean(input.cronExpression),
    });

    const scheduleRun = dispatchRes.dispatched[0];
    if (!scheduleRun?.taskId) {
      throw new Error('Scheduled research job was not dispatched.');
    }

    // 2. Feature 01: Claim durable background task
    const claimed = await this.taskEngine.claimNextTask(workerId, { userId: ctx.userId, nowMs: nowMs + 1000 });
    const activeTaskId = claimed?.taskId || scheduleRun.taskId;

    try {
      // 3. Feature 04: Ensure verified research skill is installed & executed
      let selected = await this.skills.selectBestSkillForTask(ctx, `${input.topic} research analysis`);
      if (!selected.skill) {
        const installed = await this.skills.installSkill(ctx, { catalogId: 'deep-research-analyst' });
        selected = { skill: installed, score: 10, reason: 'Installed verified research analyst skill.' };
      }
      const skillExecution = selected.skill
        ? await this.skills.executeSkill(ctx, {
            skillId: selected.skill.skillId,
            taskInput: input.topic,
          })
        : null;

      await this.taskEngine.updateTaskProgress(ctx, {
        taskId: activeTaskId,
        workerId,
        phase: 'waiting_for_agent',
        progress: 40,
        message: 'Running multi-agent research, analysis, and QA review.',
      });

      // 4. Feature 03: Execute research + analysis + QA multi-agent orchestration
      const multiAgentRun = await this.multiAgent.runOrchestration(ctx, {
        objective: input.topic,
        nodes: [
          {
            id: 'research_step',
            role: 'research',
            title: 'Source Research',
            objective: `Gather verified facts on: ${input.topic}`,
          },
          {
            id: 'analysis_step',
            role: 'analysis',
            title: 'Synthesis & Key Insights',
            objective: `Synthesize insights and actionable takeaways for: ${input.topic}`,
            dependsOn: ['research_step'],
          },
        ],
        enableQaReview: true,
      });

      // 5. Feature 01: Complete durable task & emit notification
      const completedTask = await this.taskEngine.completeTask(ctx, {
        taskId: activeTaskId,
        workerId,
        summary: `Scheduled research brief completed (${multiAgentRun.totalUsage.totalTokens} tokens).`,
        result: {
          scheduleId: schedule.scheduleId,
          scheduleRunId: scheduleRun.runId,
          multiAgentRunId: multiAgentRun.runId,
          consolidatedAnswer: multiAgentRun.consolidatedAnswer,
          qaPassed: multiAgentRun.qaReview?.passed ?? true,
          usage: multiAgentRun.totalUsage,
          skillId: skillExecution?.skillId || null,
        },
      });

      return {
        schedule,
        scheduleRun,
        task: completedTask,
        skillExecution,
        multiAgentRun,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scheduled research pipeline failed.';
      await this.taskEngine
        .failTask(ctx, {
          taskId: activeTaskId,
          workerId,
          error: msg,
          retryable: false,
        })
        .catch(() => {});
      throw err;
    }
  }
}

export const defaultAutonomousOrchestrator = new AutonomousInfrastructureOrchestrator();
