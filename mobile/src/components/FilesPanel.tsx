/**
 * 任务工作区面板（全屏）：文件 / 变动 两个 tab（预览不在这里——它在 composer 上方的高频入口）。
 *  - 文件：面包屑 + 目录列表（目录在前；点文件看内容，等宽 + 行号）。
 *  - 变动：改动文件卡片（状态徽标 + 增删行数；点开看带底色的 unified diff）。
 * 数据走任务控制通道。风格参考 VS Code / GitHub 移动端。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { RepoEntryMode, type RepoFileChange, type RepoFileStatus, type TaskControlClient } from '@/api/control';
import { authHeaders, getDownloadUrl } from '@/api/client';
import { base64DecodeToString, bytesToBase64 } from '@/messages/base64';
import { Icons, Spinner } from '@/components/Icons';
import { useTheme, type Theme } from '@/theme';

const ADD = '#3fb950';
const DEL = '#f85149';
const ADD_BG = 'rgba(63,185,80,0.14)';
const DEL_BG = 'rgba(248,81,73,0.13)';
const MAX_LINES = 1500;

type Tab = 'tree' | 'changes';

const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
const dirName = (p: string) => p.split('/').filter(Boolean).slice(0, -1).join('/');
const isDir = (f: RepoFileStatus) => f.entry_mode === RepoEntryMode.Tree;

// POSIX 路径归一化（对齐 web normalizePath）。下载接口要的是沙箱内的绝对路径。
const WORKDIR = '/workspace';
function normalizePath(p: string): string {
  const stack: string[] = [];
  for (const seg of `/${p}`.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg && seg !== '.') stack.push(seg);
  }
  return '/' + stack.join('/');
}

// 给 SAF 保存用的 MIME（zip 用 application/zip 能保住 .zip 后缀；其余给常见类型，未知用 octet-stream）。
const MIME_BY_EXT: Record<string, string> = {
  zip: 'application/zip', json: 'application/json', txt: 'text/plain', md: 'text/markdown', log: 'text/plain',
  html: 'text/html', css: 'text/css', js: 'application/javascript', pdf: 'application/pdf', csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
};
const mimeForName = (name: string) => MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusInfo(s: string | undefined, t: Theme): { letter: string; color: string; bg: string } {
  switch ((s ?? '').toUpperCase()) {
    case 'A': return { letter: 'A', color: ADD, bg: ADD_BG };
    case 'D': return { letter: 'D', color: DEL, bg: DEL_BG };
    case 'R': case 'RM': return { letter: 'R', color: t.acTx, bg: t.acGhost };
    case '??': return { letter: 'U', color: t.tx3, bg: t.bg4 };
    default: return { letter: 'M', color: t.amber, bg: t.amberGhost };
  }
}

// VS Code 风格按扩展名给文件图标着色。
function fileTint(name: string, t: Theme): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: '#3178c6', tsx: '#3178c6', js: '#d6b332', jsx: '#d6b332', mjs: '#d6b332', cjs: '#d6b332',
    json: '#c9a227', md: '#6a9ec0', mdx: '#6a9ec0', css: '#9a6fd6', scss: '#cd6799', less: '#9a6fd6',
    html: '#e34c26', vue: '#41b883', svelte: '#ff3e00', py: '#4b8bbe', go: '#00add8', rs: '#c98b6b',
    java: '#b07219', kt: '#a97bff', swift: '#f05138', rb: '#cc342d', php: '#777bb4', c: '#5c6bc0',
    h: '#5c6bc0', cpp: '#5c6bc0', sh: '#6aa84f', yml: '#cb171e', yaml: '#cb171e', toml: '#9c6f4a',
    sql: '#e38c00', png: '#a074c4', jpg: '#a074c4', jpeg: '#a074c4', gif: '#a074c4', svg: '#a074c4',
    lock: t.tx3, env: '#c9a227',
  };
  return map[ext] ?? t.tx3;
}

// ── 等宽文件内容（行号 gutter）────────────────────────────────────────────────
function CodeView({ text, t }: { text: string; t: Theme }) {
  const all = text.split('\n');
  const lines = all.slice(0, MAX_LINES);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.termBg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10, paddingRight: 16, minWidth: '100%' }}>
        <View>
          {lines.map((line, i) => (
            <View key={i} style={{ flexDirection: 'row' }}>
              <Text style={{ width: 44, textAlign: 'right', paddingRight: 12, color: t.tx3, fontFamily: 'monospace', fontSize: 11.5, lineHeight: 19 }}>{i + 1}</Text>
              <Text style={{ color: t.termTx, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19 }}>{line || ' '}</Text>
            </View>
          ))}
          {all.length > MAX_LINES ? <Text style={{ color: t.tx3, fontStyle: 'italic', marginTop: 10, paddingLeft: 56, fontSize: 12 }}>… 文件过长，仅显示前 {MAX_LINES} 行</Text> : null}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

// ── 带底色的 unified diff ─────────────────────────────────────────────────────
function DiffView({ text, t }: { text: string; t: Theme }) {
  const lines = text.split('\n').slice(0, MAX_LINES);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.termBg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8, minWidth: '100%' }}>
        <View style={{ alignSelf: 'stretch' }}>
          {lines.map((line, i) => {
            const plus = line.startsWith('+') && !line.startsWith('+++');
            const minus = line.startsWith('-') && !line.startsWith('---');
            const hunk = line.startsWith('@@');
            const meta = line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---');
            const bg = plus ? ADD_BG : minus ? DEL_BG : hunk ? t.bg3 : 'transparent';
            const color = plus ? ADD : minus ? DEL : hunk ? t.acTx : meta ? t.tx3 : t.termTx;
            return (
              <View key={i} style={{ backgroundColor: bg, paddingHorizontal: 14, paddingVertical: 1.5 }}>
                <Text style={{ color, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19 }}>{line || ' '}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function SubHeader({ title, subtitle, onBack, t, top, action }: { title: string; subtitle?: string; onBack: () => void; t: Theme; top: number; action?: React.ReactNode }) {
  return (
    <View style={{ paddingTop: top, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
      <View style={{ height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 4 }}>
        <Pressable onPress={onBack} hitSlop={8} style={{ padding: 8 }}><Icons.back size={22} color={t.tx} sw={2} /></Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: t.tx }}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={{ fontSize: 11, color: t.tx3, fontFamily: 'monospace', marginTop: 1 }}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>
    </View>
  );
}

function Empty({ icon, label, t }: { icon: React.ReactNode; label: string; t: Theme }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <Text style={{ color: t.tx3, fontSize: 13.5 }}>{label}</Text>
    </View>
  );
}

export function FilesPanel({ visible, onClose, control, initialChanges, vmId }: {
  visible: boolean;
  onClose: () => void;
  control: TaskControlClient | null;
  initialChanges?: RepoFileChange[];
  vmId?: string;
}) {
  const t = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('tree');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<RepoFileStatus[] | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [changes, setChanges] = useState<RepoFileChange[]>(initialChanges ?? []);
  const [changesLoading, setChangesLoading] = useState(false);
  const [viewer, setViewer] = useState<{ path: string; content: string | null } | null>(null);
  const [diff, setDiff] = useState<{ path: string; text: string | null } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null); // 正在下载的条目 path（'' = 根目录）
  const [dl, setDl] = useState<{ name: string; bytes: number; total: number | null } | null>(null); // 下载进度（驱动底部进度条）
  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const canceledRef = useRef(false);

  // 下载文件或目录（目录由后端打包成 zip）：下完再交给系统分享面板。
  // 会话鉴权靠 cookie：iOS 的 expo-file-system 共享系统 cookie 存储，能流式落盘（带进度、不占内存）；
  // Android 的 expo-file-system 用独立 cookie jar 不带 cookie（会 401），改用 RN 自带的 XHR（走 RN 网络栈、
  // 自动携带会话 cookie），代价是整包先进内存——@react-native-cookies/cookies 在新架构上不可用，故不走它。
  const download = useCallback(async (item: { path: string; name: string; dir: boolean }) => {
    if (downloading !== null) return;
    if (!vmId) { Alert.alert('无法下载', '开发环境不可用，请稍后重试'); return; }
    const downloadName = item.dir ? `${item.name}.zip` : item.name;
    const safeName = downloadName.replace(/[/\\:*?"<>|\s]/g, '_') || 'download';
    const url = getDownloadUrl(vmId, normalizePath(`${WORKDIR}/${item.path}`), downloadName);
    const target = `${FileSystem.cacheDirectory ?? ''}${safeName}`;
    canceledRef.current = false;
    setDownloading(item.path);
    setDl({ name: downloadName, bytes: 0, total: null });

    const share = async (uri: string) => {
      if (canceledRef.current) return;
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: safeName, mimeType: item.dir ? 'application/zip' : undefined });
      else Alert.alert('已下载', `已保存到：${uri}`);
    };
    const fail = (msg: string) => { if (!canceledRef.current) Alert.alert('下载失败', msg); };
    const done = () => { resumableRef.current = null; xhrRef.current = null; setDownloading(null); setDl(null); };
    // Android：保存到用户选择的文件夹（SAF 选目录 → 在目录里建文件 → 写入）。
    const saveToFolder = async (b64: string) => {
      try {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) return;
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perm.directoryUri, safeName, mimeForName(safeName));
        await FileSystem.writeAsStringAsync(fileUri, b64, { encoding: FileSystem.EncodingType.Base64 });
        Alert.alert('已保存', '文件已保存到所选文件夹');
      } catch (e) {
        Alert.alert('保存失败', (e as Error)?.message || '未知错误');
      }
    };

    if (Platform.OS === 'android') {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.withCredentials = true;
      const ah = authHeaders();
      for (const k in ah) xhr.setRequestHeader(k, ah[k]);
      xhr.onprogress = (e) => setDl((cur) => (cur ? { ...cur, bytes: e.loaded, total: e.lengthComputable ? e.total : null } : cur));
      xhr.onload = async () => {
        if (canceledRef.current) { done(); return; }
        try {
          const internalErr = xhr.getResponseHeader('x-internal-error');
          if (internalErr) { let m = '下载失败'; try { m = base64DecodeToString(internalErr); } catch { /* keep */ } throw new Error(`后端：${m}`); }
          if (xhr.status < 200 || xhr.status >= 300) throw new Error(`HTTP ${xhr.status}`);
          const buf = xhr.response as ArrayBuffer | null;
          if (!buf || buf.byteLength === 0) throw new Error('下载内容为空');
          const b64 = bytesToBase64(new Uint8Array(buf));
          await FileSystem.writeAsStringAsync(target, b64, { encoding: FileSystem.EncodingType.Base64 }); // 缓存副本（供分享）
          // Android 分享面板只能发给应用、不能选文件夹，所以下完让用户选：存到设备文件夹 或 分享。
          Alert.alert('下载完成', safeName, [
            { text: '保存到文件夹', onPress: () => { void saveToFolder(b64); } },
            { text: '分享', onPress: () => { void share(target); } },
            { text: '取消', style: 'cancel' },
          ]);
        } catch (e) { fail((e as Error)?.message || '未知错误'); }
        finally { done(); }
      };
      xhr.onerror = () => { fail('网络错误'); done(); };
      xhr.send();
      return;
    }

    // iOS：expo-file-system 流式下载（共享系统 cookie），原生进度、不占内存。
    try {
      const resumable = FileSystem.createDownloadResumable(url, target, { headers: authHeaders() }, (p) => {
        setDl((cur) => (cur ? { ...cur, bytes: p.totalBytesWritten, total: p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : null } : cur));
      });
      resumableRef.current = resumable;
      const res = await resumable.downloadAsync();
      resumableRef.current = null;
      if (canceledRef.current || !res) return; // 已被取消
      const internalErr = res.headers?.['x-internal-error'] ?? res.headers?.['X-Internal-Error'];
      if (internalErr) { let m = '下载失败'; try { m = base64DecodeToString(internalErr); } catch { /* keep */ } throw new Error(`后端：${m}`); }
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      await share(res.uri);
    } catch (e) {
      fail((e as Error)?.message || '未知错误');
    } finally {
      done();
    }
  }, [downloading, vmId]);

  const cancelDownload = useCallback(() => {
    canceledRef.current = true;
    try { void resumableRef.current?.cancelAsync(); } catch { /* ignore */ }
    try { xhrRef.current?.abort(); } catch { /* ignore */ }
    resumableRef.current = null;
    xhrRef.current = null;
    setDownloading(null);
    setDl(null);
  }, []);

  const loadDir = useCallback(async (p: string) => {
    if (!control) { setEntries([]); return; }
    setEntriesLoading(true);
    const list = await control.getFileList(p);
    setEntriesLoading(false);
    setEntries(list ?? []);
  }, [control]);

  const loadChanges = useCallback(async () => {
    if (!control) return;
    setChangesLoading(true);
    const c = await control.getFileChanges();
    setChangesLoading(false);
    if (c != null) setChanges(c);
  }, [control]);

  useEffect(() => {
    if (!visible) return;
    setPath(''); setViewer(null); setDiff(null);
    loadDir(''); loadChanges();
  }, [visible, loadDir, loadChanges]);

  const openDir = (p: string) => { setPath(p); loadDir(p); };
  const openFile = async (p: string) => { setViewer({ path: p, content: null }); const c = await control?.getFileContent(p); setViewer({ path: p, content: c ?? '（无法读取该文件）' }); };
  const openDiff = async (p: string) => { setDiff({ path: p, text: null }); const d = await control?.getFileDiff(p); setDiff({ path: p, text: d || '（无差异内容）' }); };

  const segs = path ? path.split('/').filter(Boolean) : [];
  const sortedEntries = (entries ?? []).filter((f) => f.name !== '.git').slice().sort((a, b) => {
    const da = isDir(a) ? 0 : 1, db = isDir(b) ? 0 : 1;
    return da !== db ? da - db : a.name.localeCompare(b.name);
  });
  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'tree', label: '文件' },
    { key: 'changes', label: '变动', count: changes.length },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (viewer ? setViewer(null) : diff ? setDiff(null) : onClose())} statusBarTranslucent>
      {viewer ? (
        <View style={{ flex: 1, backgroundColor: t.bg }}>
          <SubHeader title={baseName(viewer.path)} subtitle={viewer.path} onBack={() => setViewer(null)} t={t} top={top}
            action={<Pressable onPress={() => download({ path: viewer.path, name: baseName(viewer.path), dir: false })} hitSlop={8} style={{ padding: 8 }}>{downloading === viewer.path ? <Spinner size={18} color={t.acTx} sw={2} /> : <Icons.download size={20} color={t.tx2} sw={2} />}</Pressable>} />
          {viewer.content == null ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View> : <CodeView text={viewer.content} t={t} />}
        </View>
      ) : diff ? (
        <View style={{ flex: 1, backgroundColor: t.bg }}>
          <SubHeader title={baseName(diff.path)} subtitle={diff.path} onBack={() => setDiff(null)} t={t} top={top} />
          {diff.text == null ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View> : <DiffView text={diff.text} t={t} />}
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={{ paddingTop: top, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
            <View style={{ height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
              <Pressable onPress={onClose} hitSlop={8} style={{ padding: 8 }}><Icons.back size={22} color={t.tx} sw={2} /></Pressable>
              <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: t.tx }}>代码文件</Text>
              <Pressable onPress={() => (tab === 'tree' ? loadDir(path) : loadChanges())} hitSlop={8} style={{ padding: 8 }}>
                {(entriesLoading || changesLoading) ? <Spinner size={18} color={t.acTx} sw={2} /> : <Icons.refresh size={19} color={t.tx2} sw={2} />}
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: t.bg3, borderRadius: 12, padding: 3, marginHorizontal: 14, marginBottom: 11 }}>
              {TABS.map((seg) => {
                const on = tab === seg.key;
                return (
                  <Pressable key={seg.key} onPress={() => setTab(seg.key)} style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 9 }, on && { backgroundColor: t.bg2, ...t.shCard }]}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: on ? t.tx : t.tx3 }}>{seg.label}</Text>
                    {seg.count ? <View style={{ minWidth: 17, height: 17, borderRadius: 99, backgroundColor: on ? t.ac : t.bg4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ fontSize: 10, fontWeight: '700', color: on ? t.acInk : t.tx3 }}>{seg.count}</Text></View> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {tab === 'tree' ? (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: t.line }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 1 }}>
                  <Pressable onPress={() => openDir('')} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icons.folder size={14} color={segs.length ? t.acTx : t.tx} sw={1.9} />
                    <Text style={{ fontSize: 12.5, color: segs.length ? t.acTx : t.tx, fontWeight: '600' }}>根目录</Text>
                  </Pressable>
                  {segs.map((s, i) => {
                    const p = segs.slice(0, i + 1).join('/');
                    const last = i === segs.length - 1;
                    return (
                      <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                        <Icons.chevron size={13} color={t.tx3} sw={2} />
                        <Pressable onPress={() => openDir(p)} hitSlop={6}><Text style={{ fontSize: 12.5, color: last ? t.tx : t.acTx, fontWeight: '600', fontFamily: 'monospace' }}>{s}</Text></Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
                {/* 下载当前目录（根目录即整个项目，打包成 zip）；单个文件在文件查看页顶部下载 */}
                <Pressable onPress={() => download({ path, name: baseName(path) || 'workspace', dir: true })} hitSlop={10} style={({ pressed }) => [{ padding: 7, marginRight: 8, borderRadius: 8 }, pressed && { backgroundColor: t.bg3 }]}>
                  {downloading === path ? <Spinner size={16} color={t.acTx} sw={2} /> : <Icons.download size={18} color={t.tx2} sw={1.9} />}
                </Pressable>
              </View>
              {entriesLoading && !entries ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View>
              ) : sortedEntries.length === 0 ? (
                <Empty icon={<Icons.folder size={26} color={t.tx3} sw={1.6} />} label="此目录为空" t={t} />
              ) : (
                <ScrollView contentContainerStyle={{ paddingVertical: 4 }}>
                  {sortedEntries.map((f, i) => {
                    const dir = isDir(f);
                    return (
                      <Pressable key={f.path} onPress={() => (dir ? openDir(f.path) : openFile(f.path))}
                        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { backgroundColor: t.bg3 }]}>
                        {dir ? <Icons.folder size={19} color={t.acTx} sw={1.9} /> : <Icons.file size={18} color={fileTint(f.name, t)} sw={1.9} />}
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14.5, color: t.tx, fontWeight: dir ? '600' : '400' }}>{f.name}</Text>
                        {!dir ? <Text style={{ fontSize: 11, color: t.tx3, fontFamily: 'monospace' }}>{formatSize(f.size)}</Text> : <Icons.chevron size={16} color={t.tx3} sw={2} />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          ) : (
            changesLoading && changes.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View>
            ) : changes.length === 0 ? (
              <Empty icon={<Icons.check size={26} color={t.tx3} sw={1.9} />} label="暂无文件改动" t={t} />
            ) : (
              <ScrollView contentContainerStyle={{ padding: 14, gap: 8 }}>
                {changes.map((c) => {
                  const si = statusInfo(c.status, t);
                  return (
                    <Pressable key={c.path} onPress={() => openDiff(c.path)}
                      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line }, pressed && { borderColor: t.line2, backgroundColor: t.bg3 }]}>
                      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: si.bg, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: si.color }}>{si.letter}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>{baseName(c.path)}</Text>
                        {dirName(c.path) ? <Text numberOfLines={1} style={{ fontSize: 11, color: t.tx3, fontFamily: 'monospace', marginTop: 1.5 }}>{dirName(c.path)}</Text> : null}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 7, alignItems: 'baseline' }}>
                        {c.additions ? <Text style={{ fontSize: 12.5, fontWeight: '700', color: ADD, fontFamily: 'monospace' }}>+{c.additions}</Text> : null}
                        {c.deletions ? <Text style={{ fontSize: 12.5, fontWeight: '700', color: DEL, fontFamily: 'monospace' }}>−{c.deletions}</Text> : null}
                      </View>
                      <Icons.chevron size={16} color={t.tx3} sw={2} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )
          )}
        </View>
      )}
      {dl ? (
        // 底部下载进度条（带取消）；覆盖在文件列表/查看页之上。
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingTop: 11, paddingHorizontal: 16, paddingBottom: bottom + 11, ...t.shLift }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Spinner size={18} color={t.acTx} sw={2} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: t.tx }}>正在下载 {dl.name}</Text>
              <Text style={{ fontSize: 11.5, color: t.tx3, marginTop: 1.5 }}>
                {dl.total ? `${Math.round((dl.bytes / dl.total) * 100)}% · ${formatSize(dl.bytes)} / ${formatSize(dl.total)}` : dl.bytes > 0 ? `已下载 ${formatSize(dl.bytes)}` : '正在准备…'}
              </Text>
            </View>
            <Pressable onPress={cancelDownload} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: t.bg3 }, pressed && { backgroundColor: t.bg4 }]}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: t.tx2 }}>取消</Text>
            </Pressable>
          </View>
          {dl.total ? (
            <View style={{ height: 3, borderRadius: 99, backgroundColor: t.bg4, marginTop: 10, overflow: 'hidden' }}>
              <View style={{ height: 3, borderRadius: 99, backgroundColor: t.ac, width: `${Math.max(2, Math.round((dl.bytes / dl.total) * 100))}%` }} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}
