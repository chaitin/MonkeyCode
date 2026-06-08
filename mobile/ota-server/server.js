#!/usr/bin/env node
/**
 * 自建 expo-updates OTA 服务端（零依赖，Node 内置 http）。
 * 实现 Expo Updates 协议 v1：把 `expo export` 产出的 dist/ 包装成 multipart manifest。
 *
 * 路由：
 *   GET /            健康检查 / 信息页
 *   GET /manifest    返回 multipart/mixed manifest（客户端按 expo-platform / expo-runtime-version 头取）
 *   GET /assets?p=…  下发 bundle / 静态资源（从 dist/ 读，带防目录穿越）
 *
 * 用法：
 *   cd mobile-expo && npx expo export --platform android --platform ios   # 先产出 dist/
 *   node ota-server/server.js                                             # 默认 :4747，读 ../dist
 *   OTA_PORT=4747 OTA_DIST=/abs/path/to/dist node ota-server/server.js
 *
 * 注意（demo 简化）：本服务把客户端请求头里的 runtimeVersion 原样回填进 manifest，
 * 因此「导出的 JS」必须和「装机二进制」来自同一份代码（同一指纹）。生产环境应按
 * 导出实际指纹做匹配 / 多版本路由，并开启代码签名（expo-updates codesigning）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.OTA_PORT || 4747);
const DIST = path.resolve(process.env.OTA_DIST || path.join(__dirname, '..', 'dist'));
// 设了 OTA_ASSET_BASE_URL（如 OSS 域名）后，manifest 里的 bundle/资源 URL 直接指向它，
// server 只负责发 manifest，静态资源交给 OSS/CDN。不设则由本 server 自己发（本地联调）。
const ASSET_BASE = (process.env.OTA_ASSET_BASE_URL || '').replace(/\/$/, '');

const MIME = {
  '.js': 'application/javascript', '.hbc': 'application/javascript', '.bundle': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.lottie': 'application/json',
};
const mimeFor = (ext) => MIME[ext.startsWith('.') ? ext : '.' + ext] || 'application/octet-stream';

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const sha256b64url = (buf) => crypto.createHash('sha256').update(buf).digest('base64url');

// 由内容稳定派生一个 UUID 格式串（expo-updates 要求 manifest.id 可被解析为 UUID）。
function uuidFrom(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  const b = h.slice(0, 32).split('');
  b[12] = '4';                                   // version 4
  b[16] = ((parseInt(b[16], 16) & 0x3) | 0x8).toString(16); // variant
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function readMetadata() {
  const p = path.join(DIST, 'metadata.json');
  if (!fs.existsSync(p)) throw new Error(`找不到 ${p}，先在 mobile-expo 里跑 npx expo export`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function assetEntry(relPath, host, ext) {
  const abs = path.join(DIST, relPath);
  const buf = fs.readFileSync(abs);
  // 有 OSS：直接指向 OSS 上同样路径的文件；没有：本 server 自己发（带 ext 提示 content-type）。
  const url = ASSET_BASE
    ? `${ASSET_BASE}/${relPath.split(path.sep).join('/')}`
    : `http://${host}/assets?p=${encodeURIComponent(relPath)}${ext ? `&ext=${encodeURIComponent(ext)}` : ''}`;
  return { buf, abs, key: md5(buf), hash: sha256b64url(buf), url };
}

// 把 app.json 的 expo 配置塞进 manifest.extra.expoClient，
// 这样客户端运行 OTA 包时 Constants.expoConfig（version/name/scheme 等）才不为空。
function readExpoClient() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIST, '..', 'app.json'), 'utf8'));
    return j.expo || {};
  } catch {
    return {};
  }
}

function buildManifest(platform, runtimeVersion, host) {
  const meta = readMetadata();
  const fm = meta.fileMetadata && meta.fileMetadata[platform];
  if (!fm) throw new Error(`dist/metadata.json 里没有 platform=${platform}（已导出的：${Object.keys(meta.fileMetadata || {}).join(', ') || '无'}）`);

  const bundle = assetEntry(fm.bundle, host);
  const assets = (fm.assets || []).map((a) => {
    const e = assetEntry(a.path, host, a.ext);
    return { hash: e.hash, key: e.key, contentType: mimeFor(a.ext), fileExtension: '.' + a.ext, url: e.url };
  });

  const extra = { expoClient: readExpoClient() };
  // createdAt 取 bundle 文件 mtime，保证同一次导出多次请求结果稳定（客户端按 id 去重）。
  const createdAt = fs.statSync(bundle.abs).mtime.toISOString();
  // id 纳入 bundle/资源/extra：内容或配置变了 id 就变，客户端才会拉新 manifest。
  const id = uuidFrom(platform + bundle.key + assets.map((a) => a.key).join('') + JSON.stringify(extra));

  return {
    id,
    createdAt,
    runtimeVersion,
    launchAsset: { hash: bundle.hash, key: bundle.key, contentType: 'application/javascript', url: bundle.url },
    assets,
    metadata: {},
    extra,
  };
}

function sendManifest(req, res, query) {
  const platform = req.headers['expo-platform'] || query.get('platform');
  const runtimeVersion = req.headers['expo-runtime-version'] || query.get('runtime-version');
  const protocolVersion = req.headers['expo-protocol-version'] || '1';
  const host = req.headers.host;

  if (!platform || !runtimeVersion) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('缺少 expo-platform / expo-runtime-version（或 ?platform=&runtime-version=）');
    return;
  }
  if (req.headers['expo-expect-signature']) {
    // 未配置代码签名却被要求签名：明确报错，免得客户端静默失败。
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('客户端要求代码签名，但本服务未配置（请先 expo-updates codesigning）');
    return;
  }

  let manifest;
  try {
    manifest = buildManifest(platform, runtimeVersion, host);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(e.message || e));
    return;
  }

  const boundary = 'expo-ota-boundary';
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=utf-8\r\n' +
    'Content-Disposition: form-data; name="manifest"\r\n\r\n' +
    `${JSON.stringify(manifest)}\r\n` +
    `--${boundary}--\r\n`;

  res.writeHead(200, {
    'expo-protocol-version': protocolVersion,
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${boundary}`,
  });
  res.end(body);
  console.log(`[manifest] platform=${platform} rtv=${runtimeVersion} id=${manifest.id} assets=${manifest.assets.length}`);
}

// 最新 native 安装包版本（手动维护：每次发新 APK/IPA 就更新 native-release.json）。
// 客户端拿它和已装版本比较：更大就引导去装新包（OTA 推不动原生）。
// 客户端按 path 取：/app-version/<platform>.json —— 这样也能直接当静态文件放 OSS。
function sendAppVersion(req, res, u) {
  const m = u.pathname.match(/\/app-version\/(ios|android)(?:\.json)?$/);
  const platform = (m && m[1]) || u.searchParams.get('platform') || '';
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'native-release.json'), 'utf8')); } catch { /* none */ }
  const rel = cfg[platform] || {};
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify({ version: rel.version || null, url: rel.url || null }));
  console.log(`[app-version] platform=${platform} -> ${rel.version || '(none)'}`);
}

function sendAsset(res, query) {
  const rel = query.get('p');
  if (!rel) { res.writeHead(400).end('缺少 ?p='); return; }
  const abs = path.resolve(DIST, rel);
  if (!abs.startsWith(DIST + path.sep)) { res.writeHead(403).end('forbidden'); return; }
  if (!fs.existsSync(abs)) { res.writeHead(404).end('not found'); return; }
  const extHint = query.get('ext');
  const ext = extHint ? '.' + extHint : (path.extname(abs) || (rel.includes('/js/') ? '.hbc' : ''));
  res.writeHead(200, { 'content-type': mimeFor(ext), 'cache-control': 'public, max-age=31536000, immutable' });
  fs.createReadStream(abs).pipe(res);
  console.log(`[asset] ${rel}`);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/manifest') return sendManifest(req, res, u.searchParams);
  if (u.pathname.startsWith('/app-version')) return sendAppVersion(req, res, u);
  if (u.pathname === '/assets') return sendAsset(res, u.searchParams);
  if (u.pathname === '/') {
    let info = '(dist 尚未导出)';
    try {
      const m = readMetadata();
      info = 'platforms: ' + Object.keys(m.fileMetadata || {}).join(', ');
    } catch { /* ignore */ }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`MonkeyCode OTA server\nDIST=${DIST}\n${info}\n\nGET /manifest  (headers: expo-platform, expo-runtime-version)\nGET /assets?p=<relpath>`);
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OTA server listening on http://0.0.0.0:${PORT}  (DIST=${DIST})`);
});
