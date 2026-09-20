import { describe, expect, it, vi } from 'vitest';
import { describeResult, describeTool, parameterDecisions, planParameters, resolveArguments, unsupportedReason, usableTools, type Tool } from '../src/candidates.js';

export const tools: Tool[] = [
  { name: 'play', description: 'Start playback.' },
  { name: 'set_volume', description: 'Set the volume.', inputSchema: { type: 'object', properties: { volume: { type: 'integer', description: '0 to 100' } }, required: ['volume'] } },
  { name: 'set_repeat_mode', description: 'Set repeat.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['off', 'one', 'all'] } }, required: ['mode'] } },
  { name: 'play_song', description: 'Play a song.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, artist: { type: 'string' }, device: { type: 'string', enum: ['speaker', 'headphones'], default: 'speaker' }, shuffle: { type: 'boolean' } }, required: ['title'] } },
  { name: 'import_playlist', description: 'Import.', inputSchema: { type: 'object', properties: { tracks: { type: 'array', items: { type: 'string' } } }, required: ['tracks'] } },
  { name: 'delete_library', description: 'Delete everything.' },
];

const chosen = (id: string, answers: Record<string, unknown> = {}) => ({ id, candidate: { id, description: '' }, confidence: 1, probabilities: { [id]: 1 }, answers });

describe('tools in Jev form', () => {
  it('plans parameters, excludes inexpressible and denied tools, honours allow lists', () => {
    expect(planParameters(tools[3]).map((p) => `${p.name}:${p.kind}${p.required ? '!' : ''}`)).toEqual(['title:string!', 'artist:string', 'device:enum', 'shuffle:boolean']);
    expect(unsupportedReason(tools[4])).toMatch(/tracks/);
    const { offered, excluded } = usableTools(tools, { jev: { deny: ['delete_library'] } });
    expect(offered.map((t) => t.name)).toEqual(['play', 'set_volume', 'set_repeat_mode', 'play_song']);
    expect(excluded).toEqual([
      { tool: 'import_playlist', reason: 'required parameter(s) Jev cannot fill: tracks' },
      { tool: 'delete_library', reason: 'denied for use_jev in the config' },
    ]);
    expect(usableTools(tools, { jev: { allow: ['play'] } }).offered.map((t) => t.name)).toEqual(['play']);
  });

  it('describes tools with what they take, with config overrides, and makes optional parameter decisions', () => {
    expect(describeTool(tools[3])).toBe('Play a song. Takes title: string, artist?: string, device? (speaker|headphones), shuffle? (true|false).');
    expect(describeTool(tools[0], 'Starts playing whatever is queued.')).toBe('Starts playing whatever is queued.');
    const d = parameterDecisions(tools.slice(0, 4), 'music__');
    expect(Object.keys(d)).toEqual(['music__set_repeat_mode__mode', 'music__play_song__device', 'music__play_song__shuffle']);
    expect(d['music__play_song__device']).toMatchObject({ kind: 'choice', optional: true });
  });

  it('resolves arguments from answers, the text callback and defaults; refuses bad numbers and missing required values', async () => {
    const text = vi.fn(async (ctx: any) => (ctx.field.parameter === 'title' ? 'Blinding Lights' : ctx.field.parameter === 'volume' ? '67' : 'x'));
    // artist is optional text: not asked for, left out; device takes its default
    expect(await resolveArguments(tools[3], chosen('play_song', { play_song__shuffle: { choice: 'true', confidence: 1, probabilities: { true: 1 } } }), text, { goal: 'g' })).toEqual({ title: 'Blinding Lights', device: 'speaker', shuffle: true });
    expect(text.mock.calls.map((c: any) => c[0].field.parameter)).toEqual(['title']);
    expect(await resolveArguments(tools[1], chosen('set_volume'), text, { goal: 'g' })).toEqual({ volume: 67 });
    await expect(resolveArguments(tools[1], chosen('set_volume'), async () => 'loud', { goal: 'g' })).rejects.toThrow(/must be an integer/);
    await expect(resolveArguments(tools[2], chosen('set_repeat_mode'), text, { goal: 'g' })).rejects.toThrow(/needs "mode"/);
    expect(text.mock.calls[0][0].field).toMatchObject({ tool: 'play_song', parameter: 'title', type: 'string', required: true });
  });

  it('turns results into bounded text with an error prefix', () => {
    expect(describeResult({ content: [{ type: 'text', text: 'ok' }, { type: 'image' }] })).toEqual({ text: 'ok\n[image]', isError: false });
    expect(describeResult({ content: [{ type: 'text', text: 'x'.repeat(20) }], isError: true }, 10)).toEqual({ text: 'ERROR: xxxxxxxxxx… (10 more chars)', isError: true });
  });
});
