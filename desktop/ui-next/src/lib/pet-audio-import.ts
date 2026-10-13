/** Decode once on import, then persist a bounded portable PCM WAV for all desktop backends. */
export async function preparePetAudio(file: File): Promise<string> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('请选择 10 MB 以内的音频 / Choose audio under 10 MB');
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 30) {
      throw new Error('音效需在 30 秒以内，请先裁剪 / Trim audio to 30 seconds or less');
    }
    const channels = Math.min(buffer.numberOfChannels, 2), frames = buffer.length;
    const bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
    const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, (samples[channel]?.[frame] ?? 0)));
      view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    const array = new Uint8Array(bytes); const parts = [];
    for (let i = 0; i < array.length; i += 8192) parts.push(String.fromCharCode(...array.subarray(i, i + 8192)));
    return btoa(parts.join(''));
  } finally { await context.close(); }
}
