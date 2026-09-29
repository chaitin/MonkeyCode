import { describe, it, expect } from 'vitest';
import { PetModel, DEFAULTS, isQuiet, walletText } from '../public/pet-core.mjs';

const session = (id, status = 'running') => ({ id, title: `任务 ${id}`, status, waiting_ask: false });
const finish = id => ({ type: 'session-status', id, title: `任务 ${id}`, status: 'idle' });
const ask = (id, kind = 'approval', req = 'r1') => ({ type: 'session-ask', id, open: true, waiting_items: [{ id: req, kind }] });
const wallet = patch => ({ scope: 'account-a', status: 'ready', stale: false, credits: 200, total: 1000, remaining: 500, updated_at: 1000, ...patch });
const date = new Date(2026, 8, 28, 12).getTime();

describe('桌宠任务通知', () => {
  it('并发结束不覆盖，且点击目标随正在展示的通知切换', () => {
    const m = new PetModel(); m.snapshot([session('a'), session('b')]);
    m.event(finish('a'), 1000); m.event(finish('b'), 1000);
    expect(m.view(1000).action).toBe('session:a');
    expect(m.view(1000).tasks).toHaveLength(2);
    expect(m.view(5001).action).toBe('session:b');
    expect(m.view(9002).text).toBe('');
  });
  it('提问优先于完成，处理后继续展示其他通知', () => {
    const m = new PetModel(); m.snapshot([session('a'), session('b')]);
    m.event(finish('a'), 1000); m.view(1000);
    expect(m.event(ask('b', 'question'), 2000)).toEqual(['question']);
    expect(m.view(2000)).toMatchObject({ text: '等待回答', action: 'session:b' });
    m.view(10000);
    m.event({ type: 'session-ask', id: 'b', open: false, waiting_items: [] }, 12000);
    expect(m.view(12000).action).toBe('session:a');
  });
  it('多个等待任务打开选择菜单；同任务并存的交互不会被错误清空', () => {
    const m = new PetModel(); m.snapshot([session('a'), session('b')]);
    m.event(ask('a')); m.event(ask('b', 'design'));
    expect(m.view().action).toBe('menu');
    expect(m.view().text).toBe('2 个任务等你处理');
    m.event({ ...ask('a'), waiting_items: [{ id: 'q', kind: 'question' }, { id: 'p', kind: 'approval' }] });
    expect(m.view().tasks[0].label).toBe('等待回答 / 等待审批');
  });
  it('重复状态、重连快照和同一请求不会重复提示', () => {
    const store = new Map(); const storage = { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) };
    const m = new PetModel(storage); m.snapshot([session('a')]);
    expect(m.event(finish('a'))).toEqual(['end']);
    expect(m.event(finish('a'))).toEqual([]);
    expect(m.event(ask('a'))).toEqual(['approval']);
    expect(m.event(ask('a'))).toEqual([]);
    const restored = new PetModel(storage);
    restored.snapshot([{ ...session('a'), waiting_ask: true, waiting_items: ask('a').waiting_items }]);
    expect(restored.notices).toHaveLength(0);
    expect(restored.event(ask('a'))).toEqual([]);
    expect(restored.event(ask('a', 'question', 'r2'))).toEqual(['question']);
  });
  it('旧快照不能覆盖途中发生的状态变化或复活已删除的任务', () => {
    const m = new PetModel(); m.snapshot([session('a'), session('b')]);
    const rev = m.revision;
    m.event(ask('a')); m.event({ type: 'session-deleted', id: 'b' });
    m.snapshot([session('a'), session('b')], rev);
    expect(m.view().action).toBe('session:a');
    expect(m.sessions.has('b')).toBe(false);
  });
  it('新一轮开始会移除上一轮提示；任务归档后不再出现在队列', () => {
    const m = new PetModel(); m.snapshot([session('a')]); m.event(finish('a'));
    m.event({ type: 'session-status', id: 'a', status: 'running' });
    expect(m.notices).toHaveLength(0);
    m.event(ask('a')); m.event({ type: 'session-status', id: 'a', archived: true });
    expect(m.view().tasks).toHaveLength(0);
  });
  it('周期快照不会延后持续空闲计时，只在进入新一次空闲后重新计时', () => {
    const m = new PetModel(); m.snapshot([]); m.view(0);
    for (let now = 10000; now <= 600000; now += 10000) { m.snapshot([]); m.view(now); }
    expect(m.takeIdleSound(600000)).toBe(true);
    expect(m.takeIdleSound(600001)).toBe(false);
    m.snapshot([session('a')]); m.view(600002);
    m.event(finish('a'), 600003); m.view(600003);
    expect(m.takeIdleSound(1200003)).toBe(true);
  });
});

describe('勿扰与额度口径', () => {
  it('跨午夜、全天和临时勿扰正确计算', () => {
    const p = { ...DEFAULTS, quiet_enabled: true };
    expect(isQuiet(p, new Date(2026, 8, 28, 23).getTime())).toBe(true);
    expect(isQuiet(p, new Date(2026, 8, 28, 7).getTime())).toBe(true);
    expect(isQuiet(p, date)).toBe(false);
    expect(isQuiet({ ...p, quiet_start: 0, quiet_end: 0 }, date)).toBe(true);
    expect(isQuiet({ ...DEFAULTS, muted_until: date + 1 }, date)).toBe(true);
  });
  it('勿扰抑制完成弹出与动画，仍保留待处理任务', () => {
    const m = new PetModel(); m.prefs.muted_until = date + 100000;
    m.snapshot([session('a'), session('b')]); m.event(finish('a'), date); m.event(ask('b'), date);
    expect(m.notices).toHaveLength(0);
    expect(m.view(date)).toMatchObject({ state: 'idle', text: '等待审批', action: 'session:b' });
  });
  it('同一账号同一日同阈值只提醒一次，进程重载也不重复', () => {
    const store = new Map(); const storage = { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) };
    const m = new PetModel(storage); m.snapshot([]);
    m.updateWallet(wallet({ remaining: 190 }), date);
    expect(m.view(date).text).toContain('19%');
    m.updateWallet(wallet({ remaining: 180 }), date + 9000);
    expect(m.view(date + 9000).text).toBe('');
    const restored = new PetModel(storage); restored.snapshot([]);
    restored.updateWallet(wallet({ remaining: 180 }), date + 10000);
    expect(restored.view(date + 10000).text).toBe('');
    restored.updateWallet(wallet({ remaining: 90 }), date + 11000);
    expect(restored.view(date + 11000).text).toContain('9%');
    restored.updateWallet(wallet({ remaining: 80 }), date + 86400000);
    expect(restored.view(date + 86400000).text).toContain('8%');
  });
  it('存储不可写时内存仍去重；切账号独立提醒', () => {
    const m = new PetModel(); m.snapshot([]);
    m.updateWallet(wallet({ remaining: 80 }), date); m.view(date);
    m.updateWallet(wallet({ remaining: 80 }), date + 10000);
    expect(m.view(date + 10000).text).toBe('');
    m.updateWallet(wallet({ scope: 'account-b', remaining: 80 }), date + 11000);
    expect(m.view(date + 11000).text).toContain('8%');
  });
  it('等待与错误优先，额度随后展示，完成通知不会丢失', () => {
    const m = new PetModel(); m.snapshot([session('a'), session('b'), session('c')]);
    m.event(finish('a'), date);
    m.event({ type: 'session-status', id: 'b', status: 'error' }, date);
    m.event(ask('c'), date);
    m.updateWallet(wallet({ remaining: 90, credits: 80 }), date);
    expect(m.view(date).action).toBe('session:c');
    m.event({ type: 'session-ask', id: 'c', open: false }, date + 20000);
    expect(m.view(date + 20000).action).toBe('session:b');
    expect(m.view(date + 24001)).toMatchObject({ action: 'account', text: '今日免费额度剩余 9% · 积分剩余 80' });
    expect(m.view(date + 32002).action).toBe('session:a');
  });
  it('缓存、缺失值和零额度分别表达，不虚构零余额或人民币费用', () => {
    const m = new PetModel(); m.snapshot([]);
    m.updateWallet(wallet({ remaining: 0, stale: true }), date);
    expect(m.alert).toBeNull();
    expect(walletText(wallet({ credits: null }), 'credits')).toBe('额度暂不可用');
    expect(walletText(wallet({ credits: 0 }), 'credits')).toBe('积分 0');
    expect(walletText(wallet({ total: 0 }), 'quota')).toBe('暂无每日免费额度');
    expect(walletText(wallet({ stale: true }), 'quota')).toContain('缓存');
    m.updateWallet({ status: 'signed_out' }, date);
    expect(m.wallet.scope).toBeUndefined();
  });
});

it('点击显示准确积分余额与今日消费，不以免费 tokens 代替；跨日与缺失显示未知', () => {
  const m = new PetModel(); m.snapshot([]); m.prefs.quota_alerts = false;
  const usage_day = Math.floor((date / 1000 + 28800) / 86400);
  m.updateWallet(wallet({ credits: 12345.67, used_today: 12.5, usage_day }), date);
  m.press(); m.release(date);
  expect(m.view(date)).toMatchObject({ text: '积分余额 12,345.67\n今日已用 12.5', action: 'account' });
  expect(m.view(date + 6001).text).toBe('');
  m.prefs.bubble_seconds = 0; m.press(); m.release(date);
  expect(m.view(date + 86400000).text).toContain('今日已用 —');
  m.event(ask('a'), date);
  expect(m.view(date)).toMatchObject({ action: 'session:a' });
  expect(m.view(date).text).toContain('等待审批\n积分余额');
  m.updateWallet(wallet({ used_today: null, usage_day }), date);
  expect(m.view(date).text).toContain('今日已用 —');
});
