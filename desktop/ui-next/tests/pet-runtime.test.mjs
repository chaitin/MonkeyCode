import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { DEFAULTS } from '../public/pet-core.mjs';
vi.mock('../public/pet-audio.mjs', () => ({ PetAudio: class {
  preload(settings) { for (const key of Object.keys(settings)) if (!audio.some(a => a.key === key)) audio.push({ key, play: vi.fn(), pause: vi.fn(), volume: 0 }); }
  play(key, setting) { const a = audio.find(a => a.key === key); a.volume = setting.volume / 100; a.play(); }
  stop() { for (const a of audio) a.pause(); }
} }));

let dom, audio, listeners, invoke, dragging, prefs, master, sessions;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 28, 12));
  dom = new JSDOM('<div id="bubble"></div><div id="wrap"><div id="sprite"></div></div>', { url: 'http://localhost/pet.html' });
  Object.defineProperty(dom.window.navigator, 'platform', { value: 'Win32' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator);
  audio = []; listeners = {}; prefs = globalThis.structuredClone(DEFAULTS); master = true; sessions = []; prefs.click_bubble = 'greeting'; prefs.bubble_seconds = 3;
  dragging = vi.fn(async () => {});
  invoke = vi.fn(async cmd => {
    if (cmd === 'pet_preferences') return { preferences: prefs };
    if (cmd === 'sound_enabled') return master;
    if (cmd === 'sessions_list') return sessions;
    if (cmd === 'pet_wallet') return { status: 'signed_out' };
  });
  dom.window.__TAURI__ = { core: { invoke }, event: { listen: async (name, cb) => { listeners[name] = cb; return () => {}; } },
    window: { getCurrentWindow: () => ({ startDragging: dragging }) } };
  dom.window.document.getElementById('sprite').getBoundingClientRect = () => ({ left: 14, top: 32, right: 102, bottom: 120, width: 88, height: 88 });
  dom.window.document.getElementById('bubble').getBoundingClientRect = () => ({ left: 2, top: 2, right: 114, bottom: 26, width: 112, height: 24 });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); dom.window.close(); vi.unstubAllGlobals(); });
const boot = async () => { await import('../public/pet-runtime.mjs'); await vi.advanceTimersByTimeAsync(0); };
const mouse = (type, extra = {}) => dom.window.document.dispatchEvent(new dom.window.MouseEvent(type, {
  bubbles: true, button: 0, clientX: 58, clientY: 74, screenX: 58, screenY: 74, ...extra,
}));
const sound = name => audio.find(a => a.key === name);
const petting = () => dom.window.document.getElementById('bubble').textContent;

describe('真实桌宠页面手势与音效接线', () => {
  it('单击按下/松开分别发声与回弹，不唤起主窗口；下一次点击换回应', async () => {
    await boot(); mouse('mousedown');
    expect(sound('press').play).toHaveBeenCalledOnce();
    expect(dom.window.document.getElementById('wrap').classList.contains('pressed')).toBe(true);
    mouse('mouseup');
    expect(sound('release').play).toHaveBeenCalledOnce();
    expect(petting()).toBe('我在呢，摸摸～');
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'pet_activate')).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    mouse('mousedown'); mouse('mouseup');
    expect(petting()).toBe('嘿嘿，有点痒！');
    await vi.advanceTimersByTimeAsync(3500);
    expect(petting()).toBe('');
  });
  it('双击打开任务，点击任务气泡保持精确目标且不播放摸摸音', async () => {
    sessions = [{ id: 'task-a', title: '测试任务', status: 'running', waiting_ask: true, waiting_items: [{id:'p1',kind:'approval'}] }];
    await boot(); mouse('mousedown'); mouse('mouseup', { detail: 2 });
    expect(invoke).toHaveBeenCalledWith('pet_activate', { action: 'session:task-a' });
    expect(petting()).toBe('等待审批');
    sound('press').play.mockClear(); sound('release').play.mockClear(); invoke.mockClear();
    mouse('mousedown', { clientY: 14 }); mouse('mouseup', { clientY: 14 });
    expect(invoke).toHaveBeenCalledWith('pet_activate', { action: 'session:task-a' });
    expect(sound('press').play).not.toHaveBeenCalled();
    expect(sound('release').play).not.toHaveBeenCalled();
  });
  it('拖动和丢失焦点取消按压，不误发松开音、点击泡泡或跳转', async () => {
    await boot(); mouse('mousedown'); mouse('mousemove', { screenX: 90 }); mouse('mouseup');
    expect(dragging).toHaveBeenCalledOnce();
    expect(sound('release').play).not.toHaveBeenCalled();
    expect(petting()).toBe('');
    expect(dom.window.document.getElementById('wrap').classList.contains('pressed')).toBe(false);
    mouse('mousedown'); dom.window.dispatchEvent(new dom.window.Event('blur')); mouse('mouseup');
    expect(sound('release').play).not.toHaveBeenCalled();
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'pet_activate')).toBe(false);
  });
  it.each(['master', 'quiet', 'events'])('尊重 %s 静音，仍显示用户主动点击反馈', async mode => {
    if (mode === 'master') master = false;
    if (mode === 'quiet') prefs.muted_until = Date.now() + 10000;
    if (mode === 'events') { prefs.sounds.press.enabled = false; prefs.sounds.release.enabled = false; }
    await boot(); mouse('mousedown'); mouse('mouseup');
    expect(sound('press').play).not.toHaveBeenCalled(); expect(sound('release').play).not.toHaveBeenCalled();
    expect(petting()).toBe('我在呢，摸摸～');
  });
  it('Windows 原生窗口的手势使用同一音效与互动状态，重复松手不会重复发声', async () => {
    prefs.sounds.press.volume = 30; prefs.sounds.release.volume = 45;
    await boot();
    for (const phase of ['press', 'release', 'release']) listeners['pet-touch']({ payload: phase });
    expect(sound('press').volume).toBe(0.3); expect(sound('release').volume).toBe(0.45);
    expect(sound('release').play).toHaveBeenCalledOnce();
    expect(petting()).toBe('我在呢，摸摸～');
  });
});
