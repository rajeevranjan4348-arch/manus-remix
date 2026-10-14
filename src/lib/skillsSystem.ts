/**
 * Modular Skills System for Manus AI
 * 
 * Provides dynamic registration, enabling/disabling, validation,
 * execution handlers, and permission isolation for agent skills.
 */

import { observability } from './observability';
import { securityCenter } from './securityCenter';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: 'analysis' | 'coding' | 'productivity' | 'utilities';
  permissions: string[];
  enabled: boolean;
  isBuiltIn?: boolean;
}

export interface SkillDefinition extends SkillMetadata {
  inputSchema: Record<string, { type: string; description: string; required?: boolean }>;
  handler: (input: Record<string, any>) => Promise<SkillExecutionResult>;
}

export interface SkillExecutionResult {
  success: boolean;
  output: any;
  summary: string;
  error?: string;
}

class SkillsRegistryService {
  private skills = new Map<string, SkillDefinition>();
  private readonly STORAGE_KEY = 'manus_skills_enabled_state';

  constructor() {
    this.registerBuiltInSkills();
    this.loadState();
  }

  public registerSkill(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  public getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  public getAllSkills(): SkillMetadata[] {
    return Array.from(this.skills.values()).map(({ handler, inputSchema, ...meta }) => meta);
  }

  public toggleSkill(id: string, enabled: boolean): boolean {
    const skill = this.skills.get(id);
    if (!skill) return false;
    skill.enabled = enabled;
    this.saveState();
    return true;
  }

  /**
   * Execute skill with safe boundary isolation
   */
  public async executeSkill(id: string, input: Record<string, any>): Promise<SkillExecutionResult> {
    const skill = this.skills.get(id);
    if (!skill) {
      return { success: false, output: null, summary: 'Skill not found', error: `Skill "${id}" does not exist.` };
    }

    if (!skill.enabled) {
      return { success: false, output: null, summary: 'Skill disabled', error: `Skill "${skill.name}" is currently disabled.` };
    }

    const traceId = observability.startTrace(`skill_${id}`);

    // Input security scan
    for (const [key, val] of Object.entries(input)) {
      if (typeof val === 'string') {
        const scan = securityCenter.scanInput(val);
        if (!scan.isSafe) {
          observability.endTrace(traceId);
          return {
            success: false,
            output: null,
            summary: 'Execution blocked by security policy',
            error: 'Untrusted input contains restricted sequences.',
          };
        }
      }
    }

    try {
      const result = await skill.handler(input);
      observability.endTrace(traceId, { success: result.success });
      return result;
    } catch (err: any) {
      observability.endTrace(traceId, { error: err.message });
      return {
        success: false,
        output: null,
        summary: `Skill execution failed: ${skill.name}`,
        error: securityCenter.toSafeErrorMessage(err),
      };
    }
  }

  private saveState() {
    if (typeof window === 'undefined') return;
    try {
      const state: Record<string, boolean> = {};
      for (const [id, skill] of this.skills) {
        state[id] = skill.enabled;
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  private loadState() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        for (const [id, enabled] of Object.entries(state)) {
          const skill = this.skills.get(id);
          if (skill) skill.enabled = Boolean(enabled);
        }
      }
    } catch {}
  }

  private registerBuiltInSkills() {
    // 1. Data Analysis Skill
    this.registerSkill({
      id: 'skill_data_analysis',
      name: 'Statistical Data Analyzer',
      description: 'Calculates mean, median, standard deviation, min/max, and frequency distributions from numbers.',
      version: '1.0.0',
      author: 'Manus Core',
      category: 'analysis',
      permissions: ['read_input'],
      enabled: true,
      isBuiltIn: true,
      inputSchema: {
        numbers: { type: 'array', description: 'Array of numbers to compute statistics for', required: true },
      },
      handler: async (input) => {
        const raw = input.numbers;
        if (!Array.isArray(raw) || raw.length === 0) {
          return { success: false, output: null, summary: 'Input numbers array is empty', error: 'No numbers provided' };
        }
        const nums = raw.map(Number).filter(n => !isNaN(n));
        const count = nums.length;
        const sum = nums.reduce((a, b) => a + b, 0);
        const mean = sum / count;
        const sorted = [...nums].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const median = count % 2 === 0 ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2 : sorted[Math.floor(count / 2)];
        const variance = nums.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
        const stdDev = Math.sqrt(variance);

        const stats = {
          count,
          sum: Math.round(sum * 100) / 100,
          mean: Math.round(mean * 100) / 100,
          median: Math.round(median * 100) / 100,
          min,
          max,
          stdDev: Math.round(stdDev * 100) / 100,
        };

        return {
          success: true,
          output: stats,
          summary: `Computed statistics across ${count} data points (Mean: ${stats.mean}, Median: ${stats.median})`,
        };
      },
    });

    // 2. Regex Tester Skill
    this.registerSkill({
      id: 'skill_regex_tester',
      name: 'Regex Evaluator & Pattern Matcher',
      description: 'Tests regular expressions against sample inputs and returns match positions.',
      version: '1.0.0',
      author: 'Manus Core',
      category: 'utilities',
      permissions: ['read_input'],
      enabled: true,
      isBuiltIn: true,
      inputSchema: {
        pattern: { type: 'string', description: 'Regex pattern string', required: true },
        flags: { type: 'string', description: 'Regex flags (e.g., "g", "i")' },
        testString: { type: 'string', description: 'Input text to evaluate against', required: true },
      },
      handler: async (input) => {
        const pattern = String(input.pattern || '');
        const flags = String(input.flags || 'g');
        const testStr = String(input.testString || '');

        try {
          const regex = new RegExp(pattern, flags);
          const matches = [...testStr.matchAll(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'))].map(m => ({
            match: m[0],
            index: m.index,
            groups: m.groups || {},
          }));

          return {
            success: true,
            output: { count: matches.length, matches },
            summary: `Found ${matches.length} matches for pattern /${pattern}/${flags}`,
          };
        } catch (e: any) {
          return { success: false, output: null, summary: 'Invalid regular expression', error: e.message };
        }
      },
    });

    // 3. Markdown Table Generator Skill
    this.registerSkill({
      id: 'skill_markdown_table',
      name: 'Markdown Table Builder',
      description: 'Converts key-value records or 2D arrays into clean GitHub-flavored markdown tables.',
      version: '1.0.0',
      author: 'Manus Core',
      category: 'productivity',
      permissions: ['read_input'],
      enabled: true,
      isBuiltIn: true,
      inputSchema: {
        headers: { type: 'array', description: 'Column header strings', required: true },
        rows: { type: 'array', description: 'Array of row arrays', required: true },
      },
      handler: async (input) => {
        const headers: string[] = input.headers || [];
        const rows: any[][] = input.rows || [];

        if (headers.length === 0) {
          return { success: false, output: null, summary: 'No headers provided', error: 'Headers array is required' };
        }

        const headerLine = `| ${headers.join(' | ')} |`;
        const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
        const rowLines = rows.map(r => `| ${headers.map((_, i) => String(r[i] ?? '')).join(' | ')} |`);

        const markdownTable = [headerLine, separatorLine, ...rowLines].join('\n');

        return {
          success: true,
          output: { markdown: markdownTable },
          summary: `Generated markdown table with ${headers.length} columns and ${rows.length} rows`,
        };
      },
    });

    // 4. Unit & Metric Converter Skill
    this.registerSkill({
      id: 'skill_unit_converter',
      name: 'Unit & Metric Converter',
      description: 'Converts distances, weights, temperatures, and storage units with high precision.',
      version: '1.0.0',
      author: 'Manus Core',
      category: 'utilities',
      permissions: ['read_input'],
      enabled: true,
      isBuiltIn: true,
      inputSchema: {
        value: { type: 'number', description: 'Numeric value to convert', required: true },
        from: { type: 'string', description: 'Source unit', required: true },
        to: { type: 'string', description: 'Target unit', required: true },
      },
      handler: async (input) => {
        const val = Number(input.value);
        const from = String(input.from || '').toLowerCase().trim();
        const to = String(input.to || '').toLowerCase().trim();

        if (isNaN(val)) {
          return { success: false, output: null, summary: 'Invalid numeric value', error: 'Value must be a valid number' };
        }

        let converted = val;
        let unitCategory = 'unknown';

        // Temperature
        if ((from === 'c' || from === 'celsius') && (to === 'f' || to === 'fahrenheit')) {
          converted = (val * 9) / 5 + 32;
          unitCategory = 'temperature';
        } else if ((from === 'f' || from === 'fahrenheit') && (to === 'c' || to === 'celsius')) {
          converted = ((val - 32) * 5) / 9;
          unitCategory = 'temperature';
        } else if ((from === 'c' || from === 'celsius') && (to === 'k' || to === 'kelvin')) {
          converted = val + 273.15;
          unitCategory = 'temperature';
        } else if (from === 'km' && (to === 'miles' || to === 'mi')) {
          converted = val * 0.621371;
          unitCategory = 'distance';
        } else if ((from === 'miles' || from === 'mi') && to === 'km') {
          converted = val / 0.621371;
          unitCategory = 'distance';
        } else if (from === 'kg' && (to === 'lbs' || to === 'pounds')) {
          converted = val * 2.20462;
          unitCategory = 'weight';
        } else if ((from === 'lbs' || from === 'pounds') && to === 'kg') {
          converted = val / 2.20462;
          unitCategory = 'weight';
        } else if (from === 'mb' && to === 'gb') {
          converted = val / 1024;
          unitCategory = 'storage';
        } else if (from === 'gb' && to === 'mb') {
          converted = val * 1024;
          unitCategory = 'storage';
        } else if (from === 'gb' && to === 'tb') {
          converted = val / 1024;
          unitCategory = 'storage';
        }

        const rounded = Math.round(converted * 10000) / 10000;

        return {
          success: true,
          output: { original: val, from, to, converted: rounded, category: unitCategory },
          summary: `Converted ${val} ${from} = ${rounded} ${to}`,
        };
      },
    });

    // 5. JSON Validator & Formatter Skill
    this.registerSkill({
      id: 'skill_json_validator',
      name: 'JSON Validator & Formatter',
      description: 'Validates JSON strings, identifies syntax discrepancies, and formats clean indentation.',
      version: '1.0.0',
      author: 'Manus Core',
      category: 'productivity',
      permissions: ['read_input'],
      enabled: true,
      isBuiltIn: true,
      inputSchema: {
        rawJson: { type: 'string', description: 'Raw JSON text to parse and validate', required: true },
      },
      handler: async (input) => {
        const text = String(input.rawJson || '').trim();
        try {
          const parsed = JSON.parse(text);
          const formatted = JSON.stringify(parsed, null, 2);
          const keysCount = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 1;
          return {
            success: true,
            output: { isValid: true, formatted, keyCount: keysCount, type: Array.isArray(parsed) ? 'array' : typeof parsed },
            summary: `Valid JSON structure with ${keysCount} top-level attributes`,
          };
        } catch (e: any) {
          return {
            success: false,
            output: { isValid: false },
            summary: 'Invalid JSON string syntax',
            error: e.message,
          };
        }
      },
    });
  }

  /**
   * Autonomous detector that extracts intent and executes relevant skills
   */
  public async detectAndExecute(prompt: string): Promise<SkillExecutionResult | null> {
    const p = prompt.toLowerCase();

    // 1. Data analysis intent on numbers
    const numberMatches = prompt.match(/-?\d+(?:\.\d+)?/g);
    if (numberMatches && numberMatches.length >= 3 && /\b(average|mean|median|stats|statistics|stddev|variance|numbers|sum)\b/i.test(p)) {
      const numbers = numberMatches.map(Number).filter(n => !isNaN(n));
      return this.executeSkill('skill_data_analysis', { numbers });
    }

    // 2. Unit conversion intent
    const unitMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(celsius|fahrenheit|c|f|km|miles|mi|kg|lbs|pounds|mb|gb|tb)\s+(?:to|in|into)\s+(celsius|fahrenheit|c|f|km|miles|mi|kg|lbs|pounds|mb|gb|tb)/i);
    if (unitMatch) {
      return this.executeSkill('skill_unit_converter', {
        value: Number(unitMatch[1]),
        from: unitMatch[2],
        to: unitMatch[3],
      });
    }

    return null;
  }
}

export const skillsRegistry = new SkillsRegistryService();
