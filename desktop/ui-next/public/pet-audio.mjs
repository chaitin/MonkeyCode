// A decoded-buffer player shared by both desktop renderers. Never seek/restart a media element.
const defaults = { start: 'sound-app-start.mp3', end: 'sound-task-end.mp3', error: 'sound-task-error.mp3',
  approval: 'sound-permission.mp3', question: 'sound-permission.mp3', idle: 'sound-idle.mp3' };
export function soundPath(key, source = 'default') {
  if (source.startsWith('custom:')) return source;
  const touch = key === 'press' || key === 'release';
  if (source === 'default' && !touch) return defaults[key];
  if (source === 'toy') return `sound-pet-${key === 'press' ? 'press' : 'release'}.wav`;
  if (source === 'bell') return 'sound-pet-bell.wav';
  return `sound-pet-soft-${key === 'press' ? 'press' : 'release'}.wav`;
}
export class PetAudio {
  constructor({ readCustom, context, fetchAudio = path => fetch(path).then(r => { if (!r.ok) throw new Error('音效加载失败'); return r.arrayBuffer(); }), report = console.warn } = {}) {
    this.context = context || new (globalThis.AudioContext || globalThis.webkitAudioContext)({ latencyHint: 'interactive' });
    this.readCustom = readCustom; this.fetchAudio = fetchAudio; this.report = report;
    this.buffers = new Map(); this.voices = new Map(); this.tickets = new Map(); this.epoch = 0;
  }
  load(path) {
    if (!this.buffers.has(path)) {
      const pending = (async () => {
        let bytes;
        if (path.startsWith('custom:')) {
          const base64 = await this.readCustom(path.slice(7));
          bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
        } else bytes = await this.fetchAudio(path);
        return this.context.decodeAudioData(bytes);
      })();
      this.buffers.set(path, pending);
      pending.catch(() => { if (this.buffers.get(path) === pending) this.buffers.delete(path); });
    }
    return this.buffers.get(path);
  }
  preload(settings) {
    const paths = new Set(Object.entries(settings).map(([key, value]) => soundPath(key, value.source)));
    for (const path of this.buffers.keys()) if (!paths.has(path)) this.buffers.delete(path);
    for (const path of paths) void this.load(path).catch(error => this.report(error));
  }
  retire(group) {
    const voice = this.voices.get(group);
    if (!voice) return;
    this.voices.delete(group);
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.volume, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + 0.008);
    voice.source.stop(now + 0.01);
  }
  async play(key, setting, preview = false) {
    const group = preview ? 'preview' : ['press', 'release'].includes(key) ? 'touch' : 'notice';
    const ticket = (this.tickets.get(group) || 0) + 1;
    this.tickets.set(group, ticket);
    const epoch = this.epoch, requested = Date.now();
    try {
      // resume is called synchronously inside the user gesture; async decodes cannot queue old taps.
      const resumed = this.context.state !== 'running' ? this.context.resume() : Promise.resolve();
      const [buffer] = await Promise.all([this.load(soundPath(key, setting.source)), resumed]);
      if (epoch !== this.epoch || this.tickets.get(group) !== ticket || Date.now() - requested > (group === 'touch' ? 200 : 2000)) return;
      this.retire(group);
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      const now = this.context.currentTime, volume = setting.volume / 100;
      source.buffer = buffer; source.connect(gain); gain.connect(this.context.destination);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + 0.004);
      const end = now + Math.min(buffer.duration, 30);
      gain.gain.setValueAtTime(volume, Math.max(now + 0.004, end - 0.01)); gain.gain.linearRampToValueAtTime(0, end);
      const voice = { source, gain, volume }; this.voices.set(group, voice);
      source.onended = () => { source.disconnect(); gain.disconnect(); if (this.voices.get(group) === voice) this.voices.delete(group); };
      source.start(now); source.stop(end);
    } catch (error) { this.report(error); }
  }
  stop() {
    this.epoch++;
    for (const group of this.voices.keys()) this.retire(group);
  }
}
