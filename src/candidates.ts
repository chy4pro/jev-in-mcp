/**
 * A downstream server's tools in Jev-legal form: tools as candidates, enum and boolean
 * parameters as choices, text parameters through the calling model, results as bounded text.
 */
import type { Candidate, Chosen, Decision, JevChoiceAnswer, TextProvider } from 'jev-dev-kit';
import type { ServerConfig } from './config.js';

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export type ParamKind = 'enum' | 'boolean' | 'string' | 'number' | 'integer' | 'unsupported';

export interface ParamPlan {
  name: string;
  kind: ParamKind;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
}

const schemaType = (s: JsonSchema): string | undefined => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type);

export function planParameters(tool: Tool): ParamPlan[] {
  const schema = (tool.inputSchema || {}) as JsonSchema;
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, s]) => {
    const base = { name, required: required.has(name), description: s.description, default: s.default };
    if (Array.isArray(s.enum) && s.enum.length > 0) return { ...base, kind: 'enum' as const, enum: s.enum.map(String) };
    const t = schemaType(s);
    if (t === 'boolean') return { ...base, kind: 'boolean' as const, enum: ['true', 'false'] };
    if (t === 'string') return { ...base, kind: 'string' as const };
    if (t === 'integer') return { ...base, kind: 'integer' as const };
    if (t === 'number') return { ...base, kind: 'number' as const };
    return { ...base, kind: 'unsupported' as const };
  });
}

/** Why a tool cannot be offered to Jev, or null. */
export function unsupportedReason(tool: Tool): string | null {
  const bad = planParameters(tool).filter((p) => p.kind === 'unsupported' && p.required);
  return bad.length ? `required parameter(s) Jev cannot fill: ${bad.map((p) => p.name).join(', ')}` : null;
}

/** The sentence Jev reads for a tool: what it does and what it takes. */
export function describeTool(tool: Tool, override?: string): string {
  const params = planParameters(tool);
  const needs = params.map((p) => `${p.name}${p.required ? '' : '?'}${p.kind === 'enum' || p.kind === 'boolean' ? ` (${p.enum!.join('|')})` : `: ${p.kind}`}`);
  const what = (override || tool.description || tool.name).trim().replace(/\s+/g, ' ');
  return needs.length ? `${what} Takes ${needs.join(', ')}.` : what;
}

export const paramDecision = (tool: string, param: string) => `${tool}__${param}`;

/** Tools Jev may use on a server: expressible, allowed, not denied. */
export function usableTools(tools: Tool[], cfg: ServerConfig | undefined): { offered: Tool[]; excluded: Array<{ tool: string; reason: string }> } {
  const offered: Tool[] = [];
  const excluded: Array<{ tool: string; reason: string }> = [];
  const allow = cfg?.jev?.allow;
  const deny = new Set(cfg?.jev?.deny || []);
  for (const t of tools) {
    if (deny.has(t.name)) { excluded.push({ tool: t.name, reason: 'denied for use_jev in the config' }); continue; }
    if (allow && !allow.includes(t.name)) { excluded.push({ tool: t.name, reason: 'not in the allow list' }); continue; }
    const reason = unsupportedReason(t);
    if (reason) excluded.push({ tool: t.name, reason });
    else offered.push(t);
  }
  return { offered, excluded };
}

/** Candidates for one server's tools. */
export function toolCandidates(tools: Tool[], cfg: ServerConfig | undefined): Candidate[] {
  return tools.map((t) => ({ id: t.name, description: describeTool(t, cfg?.jev?.describe?.[t.name]) }));
}

/** One optional choice decision per enum/boolean parameter of the given tools, named `tool__param` (prefixed when asked). */
export function parameterDecisions<S>(tools: Tool[], prefix = ''): Record<string, Decision<S>> {
  const decisions: Record<string, Decision<S>> = {};
  for (const t of tools) {
    for (const p of planParameters(t)) {
      if (p.kind !== 'enum' && p.kind !== 'boolean') continue;
      decisions[prefix + paramDecision(t.name, p.name)] = {
        kind: 'choice',
        optional: true,
        fixed: p.enum!.map((v): Candidate => ({ id: v, description: v })),
        rules: `If the tool "${t.name}" is called, which value should its parameter "${p.name}"${p.description ? ` (${p.description})` : ''} take, given the task and the state?`,
      };
    }
  }
  return decisions;
}

/**
 * Builds the arguments for a chosen tool: enums and booleans from the step's answers, strings
 * and numbers from the text provider (the calling model). Throws on a missing required value
 * or a malformed number, so the loop records an action error instead of calling with a guess.
 */
export async function resolveArguments(
  tool: Tool,
  chosen: Chosen,
  text: TextProvider | undefined,
  ctx: { goal: string; state?: Record<string, unknown>; prefix?: string; server?: string }
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {};
  for (const p of planParameters(tool)) {
    if (p.kind === 'unsupported') continue;
    let value: unknown;
    if (p.kind === 'enum' || p.kind === 'boolean') {
      const a = chosen.answers[(ctx.prefix || '') + paramDecision(tool.name, p.name)] as JevChoiceAnswer | undefined;
      if (a) value = p.kind === 'boolean' ? a.choice === 'true' : a.choice;
    } else {
      // Only required text values are asked for; optional ones take their default. Asking the
      // calling model for every optional parameter costs a round trip each and rarely helps.
      if (!p.required) continue;
      if (!text) throw new Error(`"${tool.name}" needs "${p.name}" but nothing can supply text.`);
      let raw: string;
      try {
        raw = await text({
          goal: ctx.goal,
          field: { server: ctx.server, tool: tool.name, parameter: p.name, type: p.kind, description: p.description, required: p.required },
          context: ctx.state,
        });
      } catch (err: any) {
        if (err?.name === 'NeedsInput') throw err;
        if (p.required) throw new Error(`"${tool.name}" needs "${p.name}": ${err?.message || String(err)}`);
        continue;
      }
      if (p.kind === 'string') value = raw;
      else {
        const n = p.kind === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
        if (!Number.isFinite(n) || (p.kind === 'integer' && String(n) !== raw.trim())) {
          throw new Error(`"${p.name}" must be a${p.kind === 'integer' ? 'n integer' : ' number'}, got "${raw}".`);
        }
        value = n;
      }
    }
    if (value === undefined) {
      if (p.default !== undefined) value = p.default;
      else if (p.required) throw new Error(`"${tool.name}" needs "${p.name}" and no value was chosen.`);
      else continue;
    }
    args[p.name] = value;
  }
  return args;
}

/** A tool result as bounded text for the state. */
export function describeResult(result: unknown, maxChars = 800): { text: string; isError: boolean } {
  const r = result as { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean } | null;
  let text: string;
  if (r && typeof r === 'object' && Array.isArray(r.content)) {
    text = r.content.map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : `[${c.type}]`)).join('\n');
    if (!text && r.structuredContent !== undefined) text = JSON.stringify(r.structuredContent);
  } else text = typeof result === 'string' ? result : JSON.stringify(result);
  text = (text || '').trim();
  const isError = !!(r && typeof r === 'object' && r.isError);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}… (${text.length - maxChars} more chars)`;
  return { text: (isError ? 'ERROR: ' : '') + text, isError };
}
