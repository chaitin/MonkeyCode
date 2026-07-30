// 无头冒烟探针(仅 MC_DESKTOP_IPC_PROBE 下经 initialization_script 注入):
// 页面加载后自动走一遍 UI→IPC→壳配置 链路,结果经本地回环上报
// (无头环境唯一可靠的回读通道);fetch 崩溃时另有 probe_log IPC 兜底。
const report = (m) => {
  fetch('http://127.0.0.1:18240/probe/' + encodeURIComponent(m), { mode: 'no-cors' }).catch(() => {});
  try { window.__TAURI__ && window.__TAURI__.core.invoke('probe_log', { msg: m }).catch(() => {}); } catch {}
};
let hb = 0;
setInterval(() => report('hb-' + (++hb)), 2000);
window.addEventListener('error', (e) => report('jserr:' + String(e.message).slice(0, 120)));
window.addEventListener('unhandledrejection', (e) => report('rej:' + String(e.reason).slice(0, 120)));
report('script-injected:' + location.search + ':saved=' + (sessionStorage.getItem('mc-probe-saved') || '0'));
setTimeout(() => {
  if (!window.__TAURI__ || !window.__TAURI__.core) { report('no-tauri'); return; }
  window.__TAURI__.core.invoke('get_config')
    .then((cfg) => {
      report('invoke-ok');
      /* 保存→重启引擎 链路:save_config 返回即成功(UI 自行 reload)。
         延后到其他探针都完成之后(引擎重启期间 IPC 不可用) */
      if (!sessionStorage.getItem('mc-probe-saved')) {
        sessionStorage.setItem('mc-probe-saved', '1');
        setTimeout(() => {
          window.__TAURI__.core.invoke('save_config', { config: cfg })
            .then(() => report('save-ok'))
            .catch((e) => report('save-err:' + String(e).slice(0, 80)));
        }, 12000);
      }
    })
    .catch((e) => report('invoke-err:' + String(e).slice(0, 80)));
  window.__TAURI__.core.invoke('take_ui_intent')
    .then(() => report('take-intent-ok'))
    .catch((e) => report('take-intent-err:' + String(e).slice(0, 80)));
  window.__TAURI__.event.listen('mc-probe-evt', () => {})
    .then(() => report('listen-ok'))
    .catch((e) => report('listen-err:' + String(e).slice(0, 80)));
  window.__TAURI__.core.invoke('plugin:opener|open_url', { url: 'https://nav-guard.invalid/from-opener' })
    .then(() => report('opener-ok'))
    .catch((e) => report('opener-err:' + String(e).slice(0, 80)));
  /* 导航守卫探测放最后:引擎重启(save)耗时数秒,且取消中的
     在途导航在 WebKitGTK 有副作用,不能与其他探针交叠 */
  setTimeout(() => { location.href = 'https://nav-guard.invalid/x'; }, 20000);
  setTimeout(() => report('nav-guard-ok'), 21000);
}, 3000);
