import { afterEach, expect, it, vi } from 'vitest';
import { preparePetAudio } from './pet-audio-import';
afterEach(() => vi.unstubAllGlobals());
it('导入解码为可移植 PCM16，保留音频而不保存用户原路径', async () => {
  const close = vi.fn(async () => {});
  vi.stubGlobal('AudioContext', class {
    close = close;
    decodeAudioData = async () => ({ duration: 2 / 48000, numberOfChannels: 1, length: 2, sampleRate: 48000, getChannelData: () => new Float32Array([-1, 1]) });
  });
  const data = await preparePetAudio({ size: 4, arrayBuffer: async () => new ArrayBuffer(4) } as File);
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0)); const view = new DataView(bytes.buffer);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(view.getUint32(40, true)).toBe(4); expect(view.getInt16(44, true)).toBe(-32768); expect(view.getInt16(46, true)).toBe(32767);
  expect(close).toHaveBeenCalledOnce();
});
it('拒绝超长、超大、损坏音频并关闭解码上下文', async () => {
  const close = vi.fn(async () => {});
  vi.stubGlobal('AudioContext', class { close = close; decodeAudioData = async () => ({ duration: 31 }); });
  await expect(preparePetAudio({size: 4, arrayBuffer: async () => new ArrayBuffer(4)} as File)).rejects.toThrow('30');
  expect(close).toHaveBeenCalledOnce();
  await expect(preparePetAudio({size: 11 * 1024 * 1024} as File)).rejects.toThrow('10 MB');
  vi.stubGlobal('AudioContext', class { close = close; decodeAudioData = async () => { throw new Error('损坏音频'); }; });
  await expect(preparePetAudio({size: 4, arrayBuffer: async () => new ArrayBuffer(4)} as File)).rejects.toThrow('损坏');
  expect(close).toHaveBeenCalledTimes(2);
});
