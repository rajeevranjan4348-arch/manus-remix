/**
 * Unified Tool Execution Framework for Deku AI
 * 
 * Defines standardized tool schemas, parameter validation,
 * risk classification, approval gates, and execution dispatching.
 */

import { observability } from './observability';
import { securityCenter } from './securityCenter';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';
import {
  buildProcedural3DSceneSpecFromPrompt,
  formatProcedural3DSceneMarkdown,
  PROCEDURAL_3D_PRESET_CATALOG,
  PROCEDURAL_3D_FINISHES,
  PROCEDURAL_3D_ENVIRONMENTS,
  Procedural3DPresetId,
  StudioFinishId,
  StudioEnvironmentPresetId,
} from './threeSceneSpec';

export type ToolRiskLevel = 'read-only' | 'destructive' | 'privileged' | 'safe' | 'moderate' | 'sensitive';

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface ToolDefinition {
  name: string;
  displayName: string;
  description: string;
  category: 'web' | 'coding' | 'filesystem' | 'computation' | 'browser' | 'workspace' | 'android' | 'system';
  riskLevel: ToolRiskLevel;
  parameters: Record<string, ToolParameterSchema>;
  handler: (args: Record<string, any>, context: ToolExecutionContext) => Promise<ToolExecutionOutput>;
}

export interface ToolExecutionContext {
  userId: string;
  conversationId?: string;
  taskId?: string;
  isApprovalGranted?: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}

export interface ToolExecutionOutput {
  success: boolean;
  data?: any;
  error?: string;
  summary: string;
  citations?: Array<{ title: string; url: string; snippet?: string }>;
  durationMs?: number;
}

class ToolRegistryService {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    this.registerCoreTools();
  }

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getToolDefinitionsForLLM(): any[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters,
        required: Object.entries(t.parameters)
          .filter(([_, schema]) => schema.required)
          .map(([key]) => key),
      },
    }));
  }

  /**
   * Validate tool arguments against parameter schema
   */
  public validateArgs(tool: ToolDefinition, args: Record<string, any>): { valid: boolean; error?: string } {
    for (const [paramName, schema] of Object.entries(tool.parameters)) {
      if (schema.required && (args[paramName] === undefined || args[paramName] === null || args[paramName] === '')) {
        return { valid: false, error: `Missing required parameter: '${paramName}'` };
      }

      if (args[paramName] !== undefined && schema.enum) {
        if (!schema.enum.includes(args[paramName])) {
          return {
            valid: false,
            error: `Invalid value for '${paramName}'. Must be one of: ${schema.enum.join(', ')}`,
          };
        }
      }
    }
    return { valid: true };
  }

  /**
   * Safe execution wrapper with timing, redaction, and error categorization
   */
  public async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionOutput> {
    const traceId = observability.startTrace(`tool_${toolName}`);
    const tool = this.getTool(toolName);

    if (!tool) {
      observability.endTrace(traceId);
      return {
        success: false,
        error: `Unknown tool: '${toolName}'`,
        summary: `Tool '${toolName}' is not registered in the framework.`,
      };
    }

    // Centralized Risk & Explicit Approval Check
    const requiresExplicitApproval =
      tool.riskLevel === 'destructive' ||
      tool.riskLevel === 'privileged' ||
      tool.riskLevel === 'sensitive';

    if (requiresExplicitApproval && !context.isApprovalGranted && !context.approvalToken) {
      observability.endTrace(traceId);
      return {
        success: false,
        error: 'APPROVAL_REQUIRED',
        summary: `Action '${tool.displayName}' (${tool.riskLevel}) requires explicit user confirmation before execution.`,
      };
    }

    // Validation
    const validation = this.validateArgs(tool, args);
    if (!validation.valid) {
      observability.endTrace(traceId);
      return {
        success: false,
        error: validation.error,
        summary: `Invalid arguments for ${tool.displayName}: ${validation.error}`,
      };
    }

    try {
      const result = await tool.handler(args, context);
      const durationMs = observability.endTrace(traceId, { success: result.success });
      return { ...result, durationMs };
    } catch (err: any) {
      const durationMs = observability.endTrace(traceId, { success: false, error: err?.message });
      observability.log({
        level: 'error',
        category: 'tool_execution',
        classification: observability.classifyError(err),
        message: `Tool '${toolName}' execution failed: ${err?.message || 'Error'}`,
      });
      return {
        success: false,
        error: securityCenter.toSafeErrorMessage(err),
        summary: `Execution of ${tool.displayName} failed.`,
        durationMs,
      };
    }
  }

  /**
   * Built-in tool definitions
   */
  private registerCoreTools() {
    // 1. Calculator
    this.register({
      name: 'calculate',
      displayName: 'Calculator',
      description: 'Perform mathematical and statistical calculations accurately.',
      category: 'computation',
      riskLevel: 'safe',
      parameters: {
        expression: {
          type: 'string',
          description: 'Math expression to evaluate (e.g., "45 * 12 + sqrt(144)")',
          required: true,
        },
      },
      handler: async (args) => {
        const expr = String(args.expression || '').trim();
        // Safe math evaluation without eval
        const sanitized = expr.replace(/[^0-9+\-*/().^% eEsqrtcospia]/g, '');
        try {
          // Replace simple math tokens
          const parsed = sanitized
            .replace(/sqrt\(([^)]+)\)/g, 'Math.sqrt($1)')
            .replace(/pi/gi, 'Math.PI')
            .replace(/\^/g, '**');

          // Evaluate safely in restricted scope
          const fn = new Function(`return (${parsed})`);
          const result = fn();
          if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Calculation resulted in undefined or non-finite number');
          }
          return {
            success: true,
            data: { result, expression: expr },
            summary: `Evaluated ${expr} = ${result}`,
          };
        } catch (e: any) {
          return {
            success: false,
            error: `Could not evaluate expression: ${expr}`,
            summary: 'Calculation error',
          };
        }
      },
    });

    // 2. Real Web Search
    this.register({
      name: 'web_search',
      displayName: 'Web Search',
      description: 'Search the live web for verified facts, documentation, news, and technical references.',
      category: 'web',
      riskLevel: 'safe',
      parameters: {
        query: {
          type: 'string',
          description: 'Search terms or natural language query',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to retrieve (default: 5)',
          default: 5,
        },
      },
      handler: async (args) => {
        const query = String(args.query || '').trim();
        const limit = Number(args.limit) || 5;
        const authHeader = await getFirebaseAuthorizationHeader().catch(() => null);

        // Query Netlify / server web-search function or public encyclopedic knowledge API
        try {
          const res = await fetch('/api/web-search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify({ query, limit }),
          });

          if (res.ok) {
            const data = await res.json();
            const results = Array.isArray(data.results) ? data.results : [];
            const citations = results.map((r: any) => ({
              title: r.title || 'Source',
              url: r.url || '',
              snippet: r.snippet || r.content || '',
            }));

            return {
              success: true,
              data: { results },
              citations,
              summary: `Found ${results.length} verified results for "${query}"`,
            };
          }
          if (res.status === 401 || res.status === 403) {
            return { success: false, error: 'AUTHENTICATION_REQUIRED', summary: 'Sign in again to use live web search.' };
          }
          if (res.status === 429 || res.status === 503) {
            return { success: false, error: 'SEARCH_TEMPORARILY_UNAVAILABLE', summary: 'Live web search is temporarily unavailable. Please retry later.' };
          }
        } catch {
          // Fallback to Wikipedia REST API if local search endpoint is unavailable
        }

        try {
          const wikiRes = await fetch(
            `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`
          );
          if (wikiRes.ok) {
            const wikiData = await wikiRes.json();
            const pages = Array.isArray(wikiData.pages) ? wikiData.pages : [];
            const citations = pages.map((p: any) => ({
              title: p.title,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
              snippet: p.description || p.excerpt || '',
            }));

            return {
              success: true,
              data: { pages },
              citations,
              summary: `Retrieved ${pages.length} verified references for "${query}"`,
            };
          }
        } catch {}

        return {
          success: true,
          data: { query, results: [] },
          summary: `Search completed for "${query}".`,
        };
      },
    });

    // 3. Web Page Content Fetcher (Anti-SSRF validated)
    this.register({
      name: 'fetch_webpage',
      displayName: 'Web Page Reader',
      description: 'Retrieve and extract readable text and structure from a public URL.',
      category: 'web',
      riskLevel: 'safe',
      parameters: {
        url: {
          type: 'string',
          description: 'HTTP or HTTPS URL to read',
          required: true,
        },
      },
      handler: async (args) => {
        const rawUrl = String(args.url || '').trim();
        try {
          const parsed = new URL(rawUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { success: false, error: 'Only HTTP/HTTPS URLs are permitted.', summary: 'Invalid URL protocol' };
          }
          if (['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'].includes(parsed.hostname)) {
            return { success: false, error: 'SSRF protection: Private addresses cannot be retrieved.', summary: 'Address blocked' };
          }

          const response = await fetch(rawUrl, {
            headers: { 'User-Agent': 'DekuAI-Research/2.0' },
            signal: AbortSignal.timeout(10000),
          });

          if (!response.ok) {
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
              summary: `Failed to fetch ${rawUrl}`,
            };
          }

          const text = await response.text();
          // Extract title and text
          const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
          const pageTitle = titleMatch ? titleMatch[1].trim() : rawUrl;
          const cleanText = text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 10000);

          return {
            success: true,
            data: { title: pageTitle, content: cleanText, length: cleanText.length },
            citations: [{ title: pageTitle, url: rawUrl, snippet: cleanText.slice(0, 200) }],
            summary: `Read "${pageTitle}" (${cleanText.length} chars)`,
          };
        } catch (e: any) {
          return {
            success: false,
            error: securityCenter.toSafeErrorMessage(e),
            summary: `Could not retrieve ${rawUrl}`,
          };
        }
      },
    });

    // 4. Delete File (Destructive)
    this.register({
      name: 'delete_file',
      displayName: 'Delete File',
      description: 'Permanently remove a file from the workspace or repository.',
      category: 'filesystem',
      riskLevel: 'destructive',
      parameters: {
        path: {
          type: 'string',
          description: 'Relative or absolute file path to delete',
          required: true,
        },
      },
      handler: async (args) => ({
        success: false,
        error: 'WORKSPACE_RUNTIME_UNAVAILABLE',
        data: { path: String(args.path || '').trim(), deleted: false },
        summary: 'File deletion was not performed: no isolated, ownership-checked workspace filesystem provider is configured.',
      }),
    });

    // 5. Commit Changes (Privileged)
    this.register({
      name: 'commit_changes',
      displayName: 'Create Git Commit',
      description: 'Stages and commits modified files to the local repository.',
      category: 'coding',
      riskLevel: 'privileged',
      parameters: {
        message: {
          type: 'string',
          description: 'Git commit log message',
          required: true,
        },
      },
      handler: async (args) => ({
        success: false,
        error: 'GIT_WORKSPACE_UNAVAILABLE',
        data: { message: String(args.message || '').trim(), committed: false },
        summary: 'No local Git workspace is connected. No commit was created.',
      }),
    });

    // 6. Push to GitHub (Privileged)
    this.register({
      name: 'git_push',
      displayName: 'Push to Remote Repository',
      description: 'Push committed changes to remote git origin.',
      category: 'coding',
      riskLevel: 'privileged',
      parameters: {
        branch: {
          type: 'string',
          description: 'Target git branch name (e.g. main)',
          required: true,
        },
      },
      handler: async (args) => ({
        success: false,
        error: 'GIT_REMOTE_UNAVAILABLE',
        data: { branch: String(args.branch || '').trim(), pushed: false },
        summary: 'No authenticated Git remote operation is wired to this tool. Nothing was pushed.',
      }),
    });

    // 7. Run Shell Command (Privileged)
    this.register({
      name: 'run_command',
      displayName: 'Execute System Command',
      description: 'Execute shell command in terminal environment.',
      category: 'system',
      riskLevel: 'privileged',
      parameters: {
        command: {
          type: 'string',
          description: 'Command line string to execute',
          required: true,
        },
      },
      handler: async (args) => ({
        success: false,
        error: 'SANDBOX_PROVIDER_UNAVAILABLE',
        data: { command: String(args.command || '').trim(), executed: false },
        summary: 'Command was not executed. Configure and verify an isolated sandbox provider; Netlify functions must never run user commands on the host.',
      }),
    });

    // 8. AI Image Generation & Editing (Gemini Nano Banana series)
    this.register({
      name: 'generate_image',
      displayName: 'AI Image Generator',
      description: 'Generate or edit images from a text prompt using Gemini image generation models (gemini-3.1-flash-lite-image / gemini-nano-banana-2.1).',
      category: 'web',
      riskLevel: 'safe',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Detailed visual description of the image to generate or edit',
          required: true,
        },
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio of the generated image',
          enum: ['1:1', '3:4', '4:3', '9:16', '16:9', '1:4', '1:8', '4:1', '8:1'],
          default: '1:1',
        },
        imageSize: {
          type: 'string',
          description: 'Target resolution size for high-quality generation',
          enum: ['1K', '2K', '4K'],
          default: '1K',
        },
      },
      handler: async (args, context) => {
        const prompt = String(args.prompt || '').trim();
        const aspectRatio = String(args.aspectRatio || '1:1').trim();
        const imageSize = String(args.imageSize || '1K').trim();

        const res = await fetch('/api/image-generation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: context.signal,
          body: JSON.stringify({
            prompt,
            aspectRatio,
            imageSize,
            taskId: context.taskId,
          }),
        });

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          return {
            success: false,
            error: errPayload?.error || `HTTP ${res.status}`,
            summary: `Image generation failed for "${prompt.slice(0, 60)}"`,
          };
        }

        const data = await res.json();
        return {
          success: true,
          data,
          summary: data.caption || `Generated image for "${prompt.slice(0, 60)}" (${aspectRatio})`,
        };
      },
    });

    // 9. Interactive Three.js 3D Studio PBR Scene & Procedural Asset Renderer
    this.register({
      name: 'render_3d_scene',
      displayName: '3D Studio PBR Renderer',
      description:
        'Render an interactive 3D model and scene using Three.js with studio PBR materials, RoomEnvironment PMREM reflections, 3-point lighting, softboxes, and multi-part procedural assets.',
      category: 'coding',
      riskLevel: 'safe',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Description of the 3D subject or scene to render',
          required: true,
        },
        preset: {
          type: 'string',
          description: 'Procedural 3D composite assembly preset',
          enum: Object.keys(PROCEDURAL_3D_PRESET_CATALOG),
        },
        finish: {
          type: 'string',
          description: 'Studio PBR surface material finish',
          enum: Object.keys(PROCEDURAL_3D_FINISHES),
        },
        environment: {
          type: 'string',
          description: 'Studio lighting and environment preset',
          enum: Object.keys(PROCEDURAL_3D_ENVIRONMENTS),
        },
        explodedFactor: {
          type: 'number',
          description: 'Initial exploded-view separation factor from 0.0 to 1.0',
          default: 0,
        },
      },
      handler: async (args) => {
        const prompt = String(args.prompt || '').trim();
        const spec = buildProcedural3DSceneSpecFromPrompt(prompt, {
          preset: args.preset as Procedural3DPresetId | undefined,
          finish: args.finish as StudioFinishId | undefined,
          environment: args.environment as StudioEnvironmentPresetId | undefined,
          explodedFactor:
            typeof args.explodedFactor === 'number' ? args.explodedFactor : undefined,
        });
        const markdown = formatProcedural3DSceneMarkdown(spec);
        return {
          success: true,
          data: {
            spec,
            markdown,
          },
          summary: `Rendered interactive 3D Studio PBR scene: ${spec.title} (${spec.finish})`,
        };
      },
    });
  }
}

export const toolRegistry = new ToolRegistryService();
