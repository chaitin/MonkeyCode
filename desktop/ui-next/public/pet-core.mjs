// 与 DOM/音频/窗口无关的桌宠状态；macOS/Linux 与 Windows 状态页共用。
export const DEFAULTS = {
  scale: 100, snap: true, bubble: 'tasks', click_bubble: 'credits', bubble_seconds: 6, quota_alerts: true,
  quota_warning: 20, quota_critical: 10, credits_warning: 100,
  quiet_enabled: false, quiet_start: 1320, quiet_end: 480, muted_until: 0,
  sounds: Object.fromEntries(['press', 'release', 'start', 'end', 'error', 'approval', 'question', 'idle']
    .map(key => [key, { enabled: true, volume: 70, source: 'default' }])),
};

export function isQuiet(prefs, now = Date.now()) {
  if (prefs.muted_until > now) return true;
  if (!prefs.quiet_enabled) return false;
  const d = new Date(now), minute = d.getHours() * 60 + d.getMinutes();
  const a = prefs.quiet_start, b = prefs.quiet_end;
  return a === b || (a < b ? minute >= a && minute < b : minute >= a || minute < b);
}

const waitLabel = { approval: '等待审批', question: '等待回答', design: '等待选择方案' };
const terminalLabel = { idle: '已回复', finished: '完成 ✓', error: '出错 ✗', interrupted: '已中断' };
const cleanTitle = value => (value || '任务').replace(/[\r\n\t]/g, ' ').slice(0, 100);
const creditsNumber = value => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export function creditsText(wallet, now = Date.now()) {
  if (!wallet || wallet.status === 'signed_out') return '登录后查看积分';
  const sameDay = wallet.usage_day === Math.floor((now / 1000 + 28800) / 86400);
  return `积分余额 ${creditsNumber(wallet.credits)}\n今日已用 ${creditsNumber(sameDay ? wallet.used_today : null)}${wallet.stale ? '\n数据为缓存' : ''}`;
}
const number = value => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : Math.floor(value).toLocaleString('zh-CN');

function waits(session) {
  if (!session.waiting_ask) return [];
  return session.waiting_items?.length ? session.waiting_items : [{ id: session.id, kind: 'approval' }];
}

export function walletText(wallet, mode) {
  if (!wallet || wallet.status === 'signed_out') return '登录后查看额度';
  const suffix = wallet.stale ? '（缓存）' : '';
  if (mode === 'credits' && wallet.credits != null) return `积分 ${number(wallet.credits)}${suffix}`;
  if (mode === 'quota' && wallet.total > 0 && wallet.remaining != null) return `今日剩余 ${number(wallet.remaining)}${suffix}`;
  if (mode === 'quota' && wallet.total === 0) return '暂无每日免费额度';
  return '额度暂不可用';
}

export class PetModel {
  constructor(storage = null) {
    this.storage = storage;
    this.memory = new Map();
    this.sessions = new Map();
    this.versions = new Map();
    this.revision = 0;
    this.notices = [];
    this.online = false;
    this.idleSince = null;
    this.idlePlayed = false;
    this.wallet = null;
    this.alert = null;
    this.pressed = false;
    this.touchBubble = null;
    this.touchCount = 0;
    this.bounce = 0;
    this.prefs = JSON.parse(JSON.stringify(DEFAULTS));
    this.seen = new Set(this.read('pet.seen-interactions', []));
  }
  read(key, fallback) {
    if (this.memory.has(key)) return this.memory.get(key);
    try { return JSON.parse(this.storage?.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }
  write(key, value) { this.memory.set(key, value); try { this.storage?.setItem(key, JSON.stringify(value)); } catch { /* 本轮去重仍有效 */ } }
  remember(key) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    this.write('pet.seen-interactions', [...this.seen]);
    return true;
  }
  snapshot(list, startedAtRevision = this.revision) {
    const ids = new Set(list.map(s => s.id));
    for (const [id, s] of this.sessions) {
      if (!ids.has(id) && s.revision <= startedAtRevision) this.sessions.delete(id);
    }
    for (const s of list) {
      if ((this.versions.get(s.id) ?? -1) > startedAtRevision) continue;
      if (s.archived) { this.sessions.delete(s.id); continue; }
      this.sessions.set(s.id, { ...s, title: cleanTitle(s.title), revision: startedAtRevision });
      // 重连快照恢复待处理状态，但不再播放历史请求的声音。
      for (const item of waits(s)) this.remember(`${s.id}:${item.kind}:${item.id}`);
    }
    this.notices = this.notices.filter(n => this.sessions.has(n.id));
    for (const [id, revision] of this.versions) if (revision <= startedAtRevision) this.versions.delete(id);
    this.online = true;
  }
  event(e, now = Date.now()) {
    if (!e?.id) return [];
    const old = this.sessions.get(e.id);
    const next = { ...old, id: e.id, title: cleanTitle(e.title || old?.title), revision: ++this.revision };
    this.versions.set(e.id, next.revision);
    if (e.archived || e.status === 'deleted' || e.type === 'session-deleted') {
      this.sessions.delete(e.id);
      this.notices = this.notices.filter(n => n.id !== e.id);
      return [];
    }
    const sounds = [];
    if (e.type === 'session-status') {
      next.status = e.status;
      if (e.status === 'running') this.notices = this.notices.filter(n => n.id !== e.id);
      if (terminalLabel[e.status] && old?.status !== e.status) {
        const failed = e.status === 'error' || e.status === 'interrupted';
        if (!isQuiet(this.prefs, now)) {
          this.notices = this.notices.filter(n => n.id !== e.id);
          this.notices.push({ id: e.id, text: `「${next.title}」${terminalLabel[e.status]}`, title: next.title,
            label: terminalLabel[e.status], tone: failed ? 'err' : 'ok', cheer: e.status === 'finished', expires: null });
          this.notices = this.notices.slice(-100);
          this.notices.sort((a, b) => Number(b.tone === 'err') - Number(a.tone === 'err'));
        }
        sounds.push(failed ? 'error' : 'end');
      }
    } else if (e.type === 'session-ask') {
      next.waiting_ask = !!e.open;
      next.waiting_items = e.waiting_items || [];
      for (const item of waits(next)) {
        if (this.remember(`${e.id}:${item.kind}:${item.id}`)) sounds.push(item.kind === 'approval' ? 'approval' : 'question');
      }
    } else if (e.type !== 'session-summary') return [];
    this.sessions.set(e.id, next);
    this.online = true;
    return [...new Set(sounds)];
  }
  updateWallet(wallet, now = Date.now()) {
    this.wallet = wallet;
    if (!wallet?.scope || wallet.status !== 'ready' || wallet.stale) {
      this.alert = null;
      return;
    }
    if (!this.prefs.quota_alerts) { this.alert = null; return; }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const key = `pet.alerts:${wallet.scope}`;
    let seen = this.read(key, { day, levels: [] });
    if (seen.day !== day || !Array.isArray(seen.levels)) seen = { day, levels: [] };
    const levels = [];
    const ratio = wallet.total > 0 && wallet.remaining != null ? wallet.remaining / wallet.total * 100 : null;
    if (ratio != null) {
      for (const threshold of [this.prefs.quota_warning, this.prefs.quota_critical]) {
        if (ratio <= threshold) levels.push([`quota:${threshold}`, `今日免费额度剩余 ${Math.floor(ratio)}%`]);
      }
    }
    if (this.prefs.credits_warning > 0 && wallet.credits != null && wallet.credits <= this.prefs.credits_warning) {
      levels.push([`credits:${this.prefs.credits_warning}`, `积分剩余 ${number(wallet.credits)}`]);
    }
    const fresh = levels.filter(([level]) => !seen.levels.includes(level));
    if (fresh.length) {
      const quota = fresh.filter(([level]) => level.startsWith('quota:')).slice(-1);
      const credits = fresh.filter(([level]) => level.startsWith('credits:'));
      this.alert = isQuiet(this.prefs, now) ? null : { scope: wallet.scope, levels: fresh.map(([l]) => l),
        text: [...quota, ...credits].map(([, text]) => text).join(' · '), until: null };
      seen.levels.push(...fresh.map(([l]) => l));
      this.write(key, seen);
    } else if (this.alert && (this.alert.scope !== wallet.scope || !levels.some(([l]) => this.alert.levels.includes(l)))) this.alert = null;
  }
  press() {
    if (this.pressed) return false;
    this.pressed = true;
    return true;
  }
  release(now = Date.now()) {
    if (!this.pressed) return false;
    this.pressed = false;
    const replies = ['我在呢，摸摸～', '嘿嘿，有点痒！', '收到你的鼓励啦', '陪你一起加油！', '记得喝口水呀'];
    this.touchBubble = { text: replies[this.touchCount++ % replies.length], until: this.prefs.bubble_seconds === 0 ? Infinity : now + this.prefs.bubble_seconds * 1000 };
    this.bounce++;
    return true;
  }
  cancelPress() { this.pressed = false; }
  view(now = Date.now(), hovered = false) {
    const base = this.statusView(now, hovered);
    const important = base.state === 'waiting' || base.tone === 'err' || base.tone === 'warn';
    let extra = {};
    if (this.touchBubble?.until > now && this.prefs.click_bubble !== 'none') {
      if (this.prefs.click_bubble === 'credits') {
        const text = creditsText(this.wallet, now);
        extra = { text: `${important ? base.text + '\n' : ''}${text}`, action: important ? base.action : 'account',
          detail: `${base.detail}\n${text}\n今日按北京时间汇总模型、主机、工具的积分消费，不含免费 Token。\n双击猴子打开任务，右键查看更多` };
      } else if (!important) extra = { text: this.touchBubble.text, tone: '', detail: `${this.touchBubble.text}\n双击猴子打开任务，右键查看更多` };
    }
    return { ...base, ...extra, pressed: this.pressed, bounce: this.bounce };
  }

  statusView(now = Date.now(), hovered = false) {
    const pending = [], running = [];
    for (const s of this.sessions.values()) {
      if (s.archived) continue;
      if (s.waiting_ask) {
        const labels = [...new Set(waits(s).map(w => waitLabel[w.kind] || '等待处理'))];
        pending.push({ id: s.id, title: s.title, label: labels.join(' / ') });
      } else if (s.status === 'running') running.push(s);
    }
    const quiet = isQuiet(this.prefs, now);
    if (quiet) { this.notices = []; this.alert = null; }
    const idle = this.online && !pending.length && !running.length;
    if (!idle) { this.idleSince = null; this.idlePlayed = false; }
    else if (this.idleSince === null) this.idleSince = now;
    if (!pending.length) {
      while (this.notices.length && this.notices[0].expires != null && this.notices[0].expires <= now) this.notices.shift();
    }
    const tasks = [...pending];
    for (const n of this.notices) if (!tasks.some(t => t.id === n.id)) tasks.push({ id: n.id, title: n.title, label: n.label });
    for (const s of running) if (!tasks.some(t => t.id === s.id)) tasks.push({ id: s.id, title: s.title, label: '运行中' });
    const view = { state: pending.length ? 'waiting' : running.length ? 'running' : 'idle', tone: '', text: '', detail: '', action: 'main', tasks };
    if (!this.online) return { ...view, state: 'offline', text: '内核休息中 Zzz', detail: '内核连接暂不可用，右键可查看设置', action: 'settings', tasks: [] };
    if (pending.length) {
      for (const n of this.notices) n.expires = null;
      if (this.alert) this.alert.until = null;
      const first = pending[0];
      return { ...view, state: quiet ? 'idle' : 'waiting', tone: 'warn', text: pending.length > 1 ? `${pending.length} 个任务等你处理` : first.label,
        detail: pending.map(t => `${t.title} · ${t.label}`).join('\n'), action: pending.length > 1 ? 'menu' : `session:${first.id}` };
    }
    // 等待操作时不消耗其他提示的显示时间；新一轮开始时会清掉旧通知。
    const notice = this.notices[0];
    if (notice?.tone === 'err' && this.alert) this.alert.until = null;
    if (this.alert && notice?.tone !== 'err') {
      if (this.alert.until == null) this.alert.until = now + 8000;
      if (this.alert.until > now) {
        if (notice) notice.expires = null;
        return { ...view, tone: 'warn', text: this.alert.text, detail: `${this.alert.text}，点击查看账号权益`, action: 'account' };
      }
    }
    if (notice) {
      if (notice.expires == null) notice.expires = now + 4000;
      return { ...view, state: notice.cheer ? 'celebrate' : view.state, tone: notice.tone, text: notice.text,
        detail: this.notices.map(n => n.text).join('\n'), action: `session:${notice.id}` };
    }
    if (this.prefs.bubble === 'quota' || this.prefs.bubble === 'credits') {
      const text = walletText(this.wallet, this.prefs.bubble);
      return { ...view, text, detail: `${text}${this.wallet?.updated_at ? `\n更新于 ${new Date(this.wallet.updated_at).toLocaleTimeString()}` : ''}`, action: 'account' };
    }
    if (this.prefs.bubble === 'none' && !hovered) return view;
    if (running.length) return { ...view, tone: 'ok', text: hovered && running.length === 1 ? running[0].title : `${running.length} 个任务运行中`,
      detail: running.map(s => `「${s.title}」运行中`).join('\n'), action: running.length === 1 ? `session:${running[0].id}` : 'menu' };
    return { ...view, text: hovered ? '点我摸摸～' : '', detail: '单击摸摸，双击打开主窗口，右键查看任务、额度和萌宠设置' };
  }
  takeIdleSound(now = Date.now()) {
    if (this.idleSince === null || this.idlePlayed || now - this.idleSince < 600_000) return false;
    this.idlePlayed = true;
    return !isQuiet(this.prefs, now);
  }
}
