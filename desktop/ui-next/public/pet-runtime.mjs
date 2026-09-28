import { PetModel, isQuiet } from './pet-core.mjs';
import { PetAudio } from './pet-audio.mjs';
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const bubble = document.getElementById('bubble');
const sprite = document.getElementById('sprite');
const wrap = document.getElementById('wrap');
let storage;
try { storage = window.localStorage; } catch { /* 存储关闭时使用内存状态 */ }
const model = new PetModel(storage);
let currentView = model.view(), hovered = false, petScale = 1;
let soundEnabled = false, started = false, lastNative = '', snapshotBusy = false;
let walletBusy = false, walletRevision = 0, lastWalletRefresh = 0;
let retryTimer;
let wasQuiet = false;
let lastBounce = 0, bounceAnimation;
let nativeBusy = false, pendingNative;
async function flushNative() {
  if (nativeBusy || !pendingNative) return;
  nativeBusy = true;
  const view = pendingNative; pendingNative = null;
  try { await invoke('pet_native_render', { view }); } catch (error) { lastNative = ''; reportError(error); }
  finally { nativeBusy = false; if (pendingNative) void flushNative(); }
}
let player;
try { player = new PetAudio({ readCustom: id => invoke('pet_sound_read', { id }), report: error => {
  reportError(error); void invoke('pet_audio_error', { message: String(error) }).catch(() => {});
} }); } catch (error) { console.warn('[pet] 音频初始化失败', error); }
const lastPlay = new Map();
function play(key, preview = false) {
  const setting = model.prefs.sounds[key], now = Date.now();
  const cooldown = key === 'press' || key === 'release' ? 80 : 2000;
  if (!soundEnabled || !setting?.enabled || (!preview && (isQuiet(model.prefs, now) || now - (lastPlay.get(key) ?? -Infinity) < cooldown))) return;
  lastPlay.set(key, now);
  void player?.play(key, setting, preview);
}
function stopSounds() { player?.stop(); }
function reportError(error) { console.warn('[pet]', error); bubble.title = String(error); }
function applyPreferences(payload) {
  if (!payload?.preferences) return;
  stopSounds();
  model.prefs = payload.preferences;
  player?.preload(model.prefs.sounds);
  if (model.wallet) model.updateWallet(model.wallet);
  petScale = model.prefs.scale / 100;
  document.body.style.transform = `scale(${petScale})`;
  if (isQuiet(model.prefs)) stopSounds();
  render();
}
function render() {
  const quiet = isQuiet(model.prefs);
  if (quiet && !wasQuiet) stopSounds();
  wasQuiet = quiet;
  const view = model.view(Date.now(), hovered);
  currentView = view;
  wrap.classList.toggle('pressed', view.pressed);
  if (view.pressed) bounceAnimation?.cancel();
  if (view.bounce !== lastBounce) {
    lastBounce = view.bounce;
    bounceAnimation?.cancel();
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      bounceAnimation = wrap.animate?.([
        { transform: 'scale(1.10,.84)' }, { transform: 'scale(.96,1.06)', offset: .32 },
        { transform: 'scale(1.025,.97)', offset: .62 }, { transform: 'scale(1,1)' },
      ], { duration: 480, easing: 'ease-out' });
    }
  }
  // 同状态不重写 class，避免不断重启动画。
  const classes = 'st-' + view.state + (view.text ? ' has-bubble' : '');
  if (document.body.className !== classes) document.body.className = classes;
  bubble.className = view.tone;
  bubble.textContent = view.text;
  bubble.title = view.detail;
  sprite.title = `单击摸摸，双击打开任务，右键打开菜单\n${view.detail}`;
  const serialized = JSON.stringify(view);
  if (serialized !== lastNative) {
    lastNative = serialized;
    pendingNative = view; void flushNative();
  }
  if (model.takeIdleSound()) play('idle');
}
function touch(phase) {
  if (phase === 'press' && model.press()) play('press');
  if (phase === 'release' && model.release()) { play('release'); if (model.prefs.click_bubble === 'credits') void refreshWallet(true); }
  if (phase === 'cancel') model.cancelPress();
  if (phase === 'activate') invoke('pet_activate', { action: model.statusView().action }).catch(reportError);
  render();
}
async function snapshot() {
  if (snapshotBusy) return;
  snapshotBusy = true;
  const revision = model.revision;
  try {
    const list = await invoke('sessions_list');
    model.snapshot(list, revision);
    if (!started) { started = true; play('start'); }
  } catch {
    if (revision === model.revision) model.online = false;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(snapshot, 3000);
  } finally { snapshotBusy = false; render(); }
}
async function refreshWallet(force = false) {
  if (walletBusy || (force && Date.now() - lastWalletRefresh < 5000)) return;
  walletBusy = true;
  const revision = walletRevision;
  try {
    const value = await invoke('pet_wallet', { force });
    if (revision === walletRevision) { model.updateWallet(value); lastWalletRefresh = Date.now(); }
  } catch { if (revision === walletRevision && model.wallet) model.wallet = { ...model.wallet, stale: true }; }
  finally {
    walletBusy = false; render();
    if (revision !== walletRevision) void refreshWallet();
  }
}
function invalidateWallet() {
  walletRevision++; model.wallet = null; model.alert = null; lastWalletRefresh = 0;
  render(); void refreshWallet();
}
async function boot() {
  await Promise.all([
    listen('session-event', ({ payload }) => {
      for (const sound of model.event(payload)) play(sound);
      render();
      if (['idle','finished','error','interrupted'].includes(payload?.status)) void refreshWallet(true);
    }),
    listen('sound-enabled', ({ payload }) => { soundEnabled = payload !== false; if (!soundEnabled) stopSounds(); }),
    listen('pet-preferences', ({ payload }) => applyPreferences(payload)),
    listen('pet-refresh-wallet', () => void refreshWallet(true)),
    listen('pet-error', ({ payload }) => reportError(payload)),
    listen('pet-preview-sound', ({ payload }) => play(payload, true)),
    // Windows 原生可见窗口把手势交给同一状态页，保证触摸、气泡和声音一致。
    listen('pet-touch', ({ payload }) => touch(payload)),
    listen('monkeycode-transport-changed', invalidateWallet),
    listen('pet-wallet-invalidated', invalidateWallet),
  ]);
  await Promise.all([
    invoke('pet_preferences').then(applyPreferences).catch(reportError),
    invoke('sound_enabled').then(on => { soundEnabled = on !== false; }).catch(reportError),
  ]);
  void snapshot(); void refreshWallet();
  setInterval(snapshot, 10000);
  setInterval(() => void refreshWallet(), 60000);
  setInterval(render, 500);
}
void boot().catch(reportError);

  // ---- 交互:拖动(位移阈值)与点击(唤回主窗口) ----
  // macOS 不能走原生 startDragging:tao 在 mac 上用 performWindowDragWithEvent,
  // 它只认"当下正在处理的 mousedown 事件"——阈值方案到 mousemove 才发起,
  // 事件已过期,原生拖拽静默失败(窗口不动,松手还被判成点击)。
  // mac 改为手动移窗(setPosition 跟随鼠标);Windows/Linux 保留原生拖拽
  // (WM_NCLBUTTONDOWN/合成器语义,按住期间任何时刻发起都有效,且更顺滑)。
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const petWin = () => window.__TAURI__.window.getCurrentWindow();
  let down = null, dragged = false, winPos = null;
  let nativeDrag = false, moveTimer, lastMoved = '';
  // Linux 的 startDragging 只投递窗口消息，不等待松手；以移动停止兜底收口。
  if (!isMac && /Linux/i.test(navigator.platform || navigator.userAgent)) {
    petWin().onMoved(({ payload }) => {
      if (!nativeDrag) return;
      const position = `${payload.x},${payload.y}`;
      if (position === lastMoved) return;
      lastMoved = position;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => invoke('pet_drag_finished').catch(reportError), 600);
    }).catch(reportError);
  }

  // macOS 的透明 NSPanel 默认仍按完整矩形吃鼠标。按精灵图当前帧的 alpha
  // 和气泡实际形状做命中检测；光标落在透明像素时临时开启穿透。
  // 穿透后页面收不到 mousemove，所以用全局光标位置低频探测重新进入热区。
  const MAC_HIT_POLL_MS = 50;
  const SPRITE_CSS_SIZE = 88;
  const SPRITE_SOURCE_SIZE = 176;
  const SPRITE_FRAMES = 52;
  const SPRITE_ALPHA_HIT = 20;
  let macSpriteMasks = null;
  let macWindowOrigin = null;
  let macCursorScale = window.devicePixelRatio || 1;
  let macOriginUpdatedAt = 0;
  let macIgnoring = null;
  let macHitPollBusy = false;

  function buildMacSpriteMasks() {
    if (!isMac) return;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SPRITE_CSS_SIZE;
      canvas.height = SPRITE_CSS_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const masks = [];
      for (let frame = 0; frame < SPRITE_FRAMES; frame++) {
        ctx.clearRect(0, 0, SPRITE_CSS_SIZE, SPRITE_CSS_SIZE);
        ctx.drawImage(image,
          frame * SPRITE_SOURCE_SIZE, 0, SPRITE_SOURCE_SIZE, SPRITE_SOURCE_SIZE,
          0, 0, SPRITE_CSS_SIZE, SPRITE_CSS_SIZE);
        const rgba = ctx.getImageData(0, 0, SPRITE_CSS_SIZE, SPRITE_CSS_SIZE).data;
        const alpha = new Uint8Array(SPRITE_CSS_SIZE * SPRITE_CSS_SIZE);
        for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
        masks.push(alpha);
      }
      macSpriteMasks = masks;
    };
    image.src = 'pet-sprite.webp';
  }

  function inRoundedRect(x, y, rect, radius) {
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
    const cx = Math.max(rect.left + radius, Math.min(x, rect.right - radius));
    const cy = Math.max(rect.top + radius, Math.min(y, rect.bottom - radius));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  }

  function inBubble(x, y) {
    if (!bubble.textContent) return false;
    const rect = bubble.getBoundingClientRect();
    if (inRoundedRect(x, y, rect, 9 * petScale)) return true;
    // ::after 的 8×4 三角尾巴不在 getBoundingClientRect 内。
    const tailY = y - rect.bottom;
    return tailY >= 0 && tailY < 4 * petScale && Math.abs(x - (rect.left + rect.right) / 2) <= 4 * petScale - tailY;
  }

  function inSpritePixel(x, y) {
    const rect = sprite.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
    // 图片尚未解码时先以 88×88 兜底，避免启动瞬间宠物完全点不到。
    if (!macSpriteMasks) return true;
    const backgroundX = Number.parseFloat(getComputedStyle(sprite).backgroundPositionX) || 0;
    const frame = Math.max(0, Math.min(SPRITE_FRAMES - 1,
      Math.round(-backgroundX / SPRITE_CSS_SIZE)));
    const px = Math.max(0, Math.min(SPRITE_CSS_SIZE - 1, Math.floor((x - rect.left) / (rect.width / SPRITE_CSS_SIZE))));
    const py = Math.max(0, Math.min(SPRITE_CSS_SIZE - 1, Math.floor((y - rect.top) / (rect.height / SPRITE_CSS_SIZE))));
    return macSpriteMasks[frame][py * SPRITE_CSS_SIZE + px] >= SPRITE_ALPHA_HIT;
  }

  function inMacPetHotRegion(x, y) {
    return inBubble(x, y) || inSpritePixel(x, y);
  }

  async function setMacMouseIgnoring(ignore) {
    if (!isMac || down || macIgnoring === ignore) return;
    macIgnoring = ignore;
    try {
      await petWin().setIgnoreCursorEvents(ignore);
    } catch {
      macIgnoring = null;
    }
  }

  async function pollMacHotRegion() {
    if (!isMac || down || macHitPollBusy) return;
    macHitPollBusy = true;
    try {
      const now = Date.now();
      if (!macWindowOrigin || now - macOriginUpdatedAt > 1000) {
        const [origin, primary] = await Promise.all([
          petWin().outerPosition(),
          window.__TAURI__.window.primaryMonitor(),
        ]);
        macWindowOrigin = origin;
        macCursorScale = primary && primary.scaleFactor || 1;
        macOriginUpdatedAt = now;
      }
      const cursor = await window.__TAURI__.window.cursorPosition();
      // Tao 的全局光标按主屏 scaleFactor 返回，窗口位置按当前屏幕返回；
      // 分别还原为逻辑坐标，兼容 Retina + 普通屏混用。
      const windowScale = window.devicePixelRatio || 1;
      const x = cursor.x / macCursorScale - macWindowOrigin.x / windowScale;
      const y = cursor.y / macCursorScale - macWindowOrigin.y / windowScale;
      await setMacMouseIgnoring(!inMacPetHotRegion(x, y));
    } catch {
      // 旧系统偶发取不到全局光标时保持上次状态，下一轮重试。
    } finally {
      macHitPollBusy = false;
    }
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const onBubble = inBubble(e.clientX, e.clientY);
    if (!onBubble && !inSpritePixel(e.clientX, e.clientY)) return;
    nativeDrag = false;
    clearTimeout(moveTimer);
    down = { x: e.screenX, y: e.screenY, onBubble, action: currentView.action };
    dragged = false;
    if (!onBubble) touch('press');
    winPos = null;
    if (isMac) petWin().outerPosition().then((p) => {
      winPos = p;
      macWindowOrigin = p;
      macOriginUpdatedAt = Date.now();
    }).catch(() => {});
  });
  document.addEventListener('mousemove', (e) => {
    if (isMac && !down) setMacMouseIgnoring(!inMacPetHotRegion(e.clientX, e.clientY));
    if (!down) return;
    const dx = e.screenX - down.x, dy = e.screenY - down.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) <= 4) return;
    if (!dragged) touch('cancel');
    dragged = true;
    if (isMac) {
      if (!winPos) return; // outerPosition 未返回前先不动
      const s = window.devicePixelRatio || 1; // screenX 是逻辑坐标,窗口位置是物理像素
      const x = Math.round(winPos.x + dx * s), y = Math.round(winPos.y + dy * s);
      macWindowOrigin = { x, y };
      macOriginUpdatedAt = Date.now();
      petWin().setPosition(new window.__TAURI__.dpi.PhysicalPosition(x, y));
    } else {
      down = null; // OS 接管拖动后 mouseup 不可靠,直接终结本次手势
      nativeDrag = true;
      petWin().startDragging().catch(reportError);
    }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (down && !dragged) {
      if (down.onBubble) invoke('pet_activate', { action: down.action }).catch(reportError);
      else { touch('release'); if (e.detail === 2) touch('activate'); }
    }
    else if (down && dragged) invoke('pet_drag_finished').catch(reportError);
    down = null;
  });
  function cancelGesture() { down = null; touch('cancel'); }
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelGesture(); invoke('pet_menu').catch(reportError); });
  window.addEventListener('blur', cancelGesture);
  document.addEventListener('pointercancel', cancelGesture);
  document.addEventListener('mouseenter', () => { hovered = true; render(); });
  document.addEventListener('mouseleave', () => { hovered = false; render(); });
  if (isMac) {
    buildMacSpriteMasks();
    pollMacHotRegion();
    setInterval(pollMacHotRegion, MAC_HIT_POLL_MS);
  }
