import { describe, it, expect, vi } from 'vitest';
import { PetAudio, soundPath } from '../public/pet-audio.mjs';
function context() {
  const sources = [];
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  return { sources, state: 'running', currentTime: 0, destination: {}, resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: .12 })),
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => { const s = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; } };
}
const setting = { source: 'soft', volume: 35 };
describe('decoded sound playback', () => {
  it('rapid taps reuse decoded buffers and retire the previous touch voice without seeking', async () => {
    const ctx = context(), fetchAudio = vi.fn(async () => new ArrayBuffer(4));
    const player = new PetAudio({ context: ctx, fetchAudio });
    for (let i = 0; i < 60; i++) await player.play(i % 2 ? 'release' : 'press', setting);
    expect(fetchAudio).toHaveBeenCalledTimes(2); expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(player.voices.size).toBe(1);
    expect(ctx.sources.slice(0, -1).every(s => s.stop.mock.calls.length === 2)).toBe(true);
    for (const source of ctx.sources.slice(0,-1)) source.onended();
    expect(player.voices.size).toBe(1); // old ended callback must not clear the newer voice
  });
  it('a delayed decode cannot queue obsolete clicks or play after mute', async () => {
    const ctx = context(); let decode;
    ctx.decodeAudioData = vi.fn(() => new Promise(resolve => { decode = resolve; }));
    const player = new PetAudio({ context: ctx, fetchAudio: async () => new ArrayBuffer(4) });
    const taps = Array.from({ length: 40 }, () => player.play('press', setting));
    await Promise.resolve(); await Promise.resolve();
    decode({ duration: .1 }); await Promise.all(taps);
    expect(ctx.sources).toHaveLength(1);
    const late = player.play('release', setting); await Promise.resolve(); await Promise.resolve();
    player.stop(); decode({ duration: .1 }); await late;
    expect(ctx.sources).toHaveLength(1);
  });
  it('custom audio loads through the controlled command; failures can be retried', async () => {
    const ctx = context(), readCustom = vi.fn().mockRejectedValueOnce(new Error('missing')).mockResolvedValue('AAAA');
    const report = vi.fn(), player = new PetAudio({ context: ctx, readCustom, report });
    const custom = { ...setting, source: `custom:${'a'.repeat(64)}` };
    await player.play('press', custom); expect(report).toHaveBeenCalledOnce();
    await player.play('press', custom); expect(ctx.sources).toHaveLength(1);
    expect(readCustom).toHaveBeenCalledTimes(2); expect(soundPath('press')).toContain('soft-press');
  });
});
