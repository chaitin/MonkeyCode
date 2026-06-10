import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ApiError, getTaskDetail, getTaskRounds, listModels } from '@/api/client';
import { TaskControlClient, type PortForwardInfo, type RepoFileChange } from '@/api/control';
import { TaskStreamClient, type StreamState } from '@/api/stream';
import { MAX_ATTACHMENTS, pickImages, saveImageToAlbum, uploadImage } from '@/api/upload';
import { AiConsentModal, useAiConsent } from '@/components/AiConsent';
import type { Model, ProjectTask } from '@/api/types';
import { Glass } from '@/components/glass';
import { Icons, Spinner } from '@/components/Icons';
import { ModelIcon } from '@/components/ModelIcon';
import { CopySheet, ModelSheet, PreviewSheet, SkillSheet } from '@/components/sheets';
import { FilesPanel } from '@/components/FilesPanel';
import { MicButton } from '@/components/MicButton';
import { usePreview } from '@/components/PreviewProvider';
import { useSpeechToText } from '@/speech/useSpeechToText';
import { StreamBlock, type AnswerMap } from '@/components/StreamBlocks';
import { EmptyView, IconButton, LoadingView, Ring, RunTimer, Scrim, Toast, TypingDots } from '@/components/ui';
import { modelLabel } from '@/config';
import { decodeChunks, type ChatMessage } from '@/messages/handler';
import { spacing, useTheme, type Theme } from '@/theme';
import { formatTokens, modelDisplayName, taskDisplayName } from '@/utils/format';

const ROUNDS_PER_FETCH = 1;
const POLL_INTERVAL = 10000;
// 指令：继续/压缩 直接发消息；重启/重置 走控制通道 restart(load_session)
type CmdKey = 'continue' | 'skill' | 'compact' | 'restart' | 'reset';
type Cmd = { key: CmdKey; label: string; tone: 'ac' | 'neutral' | 'amber' | 'red'; icon?: string; desc?: string };
// composer 里待发送的图片附件：先本地预览，异步上传；status=done 且有 url 才会随消息发出。
type PendingAtt = { key: string; localUri: string; name: string; status: 'uploading' | 'done' | 'error'; url?: string };
// 直接展示的常用指令（使用技能会打开技能选择面板）
const DIRECT_COMMANDS: Cmd[] = [
  { key: 'skill', label: '使用技能', tone: 'ac' },
];
// composer 上方的常用快捷方式：点一下直接把这句话发出去（和原来的「继续」一样）。
const QUICK_PROMPTS: { label: string; text: string }[] = [
  { label: '继续', text: '继续' },
  { label: '你决定', text: '你决定' },
  { label: '提交代码', text: '提交代码' },
];
// 收进「⋯ 更多」里的低频/有破坏性的指令，避免误触
const MORE_COMMANDS: Cmd[] = [
  { key: 'compact', label: '压缩对话', tone: 'neutral', icon: 'sparkle', desc: '压缩上下文，释放 token 空间' },
  { key: 'restart', label: '重启 Agent', tone: 'amber', icon: 'refresh', desc: '重启 Agent 并保留当前上下文' },
  { key: 'reset', label: '重置对话', tone: 'red', icon: 'trash', desc: '清空上下文并重启 Agent' },
];
function cmdTone(tone: string, t: Theme): { bg: string; color: string } {
  switch (tone) {
    case 'ac': return { bg: t.acGhost, color: t.acTx };
    case 'amber': return { bg: t.amberGhost, color: t.amber };
    case 'red': return { bg: t.redGhost, color: t.red };
    default: return { bg: t.bg4, color: t.tx2 };
  }
}

// 开发环境（VM）准备阶段的条件 → 文案（对齐 Web getConditionTypeText）
const CONDITION_LABELS: Record<string, string> = {
  Scheduled: '正在初始化',
  ImagePulled: '正在拉取系统镜像',
  ProjectCloned: '正在克隆代码仓库',
  ImageBuilt: '正在构建系统镜像',
  ContainerCreated: '正在创建开发环境',
  ContainerStarted: '正在启动开发环境',
  Ready: '开发环境已准备好',
  Failed: '无法创建开发环境',
};
function taskConditionInfo(task: ProjectTask | null): { label: string; message?: string; failed: boolean } | null {
  const conds = task?.virtualmachine?.conditions;
  if (!conds || conds.length === 0) return null;
  const last = conds[conds.length - 1];
  return { label: CONDITION_LABELS[last.type ?? ''] ?? '正在准备开发环境', message: last.message, failed: last.type === 'Failed' };
}

function ctxColor(pct: number, t: Theme): string {
  if (pct >= 0.8) return t.red;
  if (pct >= 0.6) return t.amber;
  return t.ac;
}

export default function TaskDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const aiConsent = useAiConsent(); // 进入可交互任务前需先取得 AI 数据处理同意（App Store 2.1）

  const [task, setTask] = useState<ProjectTask | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [liveState, setLiveState] = useState<StreamState | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAtt[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [restartBusy, setRestartBusy] = useState<null | 'restart' | 'reset'>(null);
  const [headerH, setHeaderH] = useState(insets.top + 104);
  const [lastCtx, setLastCtx] = useState<{ used: number; size: number } | null>(null); // 最近一次有效上下文用量（跨轮持久）
  const [previewPorts, setPreviewPorts] = useState<PortForwardInfo[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { preview, open: openPreviewUrl, expand: expandPreview } = usePreview(); // 全局预览（挂在 App 根，跨页面存活）
  const [portsRefreshing, setPortsRefreshing] = useState(false);
  const [fileChanges, setFileChanges] = useState<RepoFileChange[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);

  const clientRef = useRef<TaskStreamClient | null>(null);
  const liveStateRef = useRef<StreamState | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const cursorSeededRef = useRef(false);
  const restSeedingRef = useRef(false); // 防止 REST 兜底取游标时重入
  const controlRef = useRef<TaskControlClient | null>(null);
  const attachmentsRef = useRef<PendingAtt[]>([]);
  const attachSeq = useRef(0);

  const interactive = task?.status === 'processing';
  const starting = task?.status === 'pending';
  const startCond = starting ? taskConditionInfo(task) : null; // 启动阶段的开发环境准备进度

  const setLive = useCallback((s: StreamState | null) => { liveStateRef.current = s; setLiveState(s); }, []);
  const flashToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2400); }, []);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  // 拉取开发环境监听端口（用于在线预览）；控制通道未连接时直接返回。
  const refreshPorts = useCallback(async () => {
    const ctrl = controlRef.current;
    if (!ctrl?.connected) return;
    setPortsRefreshing(true);
    const ports = await ctrl.getPortForwardList();
    setPortsRefreshing(false);
    if (ports != null) setPreviewPorts(ports);
  }, []);

  // 拉取文件改动列表（用于「文件」面板的变动 tab + 头部按钮高亮）。
  const refreshChanges = useCallback(async () => {
    const ctrl = controlRef.current;
    if (!ctrl?.connected) return;
    const c = await ctrl.getFileChanges();
    if (c != null) setFileChanges(c);
  }, []);

  const loadInitial = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const detail = await getTaskDetail(id);
      setTask(detail);
      if (detail?.status === 'finished' || detail?.status === 'error') {
        const rounds = await getTaskRounds({ id, limit: ROUNDS_PER_FETCH });
        setHistoryMessages(decodeChunks(rounds.chunks ?? []).messages);
        setCursor(rounds.next_cursor);
        setHasMore(!!rounds.has_more && !!rounds.next_cursor);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  useEffect(() => {
    if (!id || !interactive) return;
    const client = TaskStreamClient.attach(id, { onState: (s) => setLive(s) });
    clientRef.current = client; client.connect();
    return () => { client.disconnect(); if (clientRef.current === client) clientRef.current = null; setLive(null); cursorSeededRef.current = false; };
  }, [id, interactive, setLive]);

  useEffect(() => {
    if (!id || !interactive) return;
    // 控制通道连上即刷新端口/改动；之后由 port_change / repo_file_change 事件驱动刷新（不随每条消息拉取）。
    const control = new TaskControlClient(id, {
      onStatus: (connected) => { if (connected) { refreshPorts(); refreshChanges(); } },
      onPortChange: () => { refreshPorts(); },
      onRepoFileChange: () => { refreshChanges(); },
    });
    controlRef.current = control; control.connect();
    listModels().then(setModels).catch(() => undefined);
    return () => { control.dispose(); if (controlRef.current === control) controlRef.current = null; setPreviewPorts([]); setFileChanges([]); };
  }, [id, interactive, refreshPorts, refreshChanges]);

  const doSwitchModel = useCallback(async (model: Model) => {
    if (!model.id) return;
    const control = controlRef.current;
    if (!control || !control.connected) { setToast('控制通道未就绪，请稍候重试'); setTimeout(() => setToast(null), 2200); return; }
    setSwitching(true);
    const resp = await control.switchModel(model.id);
    setSwitching(false);
    if (resp?.success) {
      setTask((prev) => (prev ? { ...prev, model: { id: model.id, model: model.model, remark: model.remark } } : prev));
      setToast(`已切换到 ${modelLabel(model)}`);
    } else {
      setToast(resp?.message || resp?.error || '切换失败，请重试');
    }
    setTimeout(() => setToast(null), 2400);
  }, []);

  const requestSwitchModel = useCallback((modelId: string) => {
    setModelPickerOpen(false);
    const model = models.find((m) => m.id === modelId);
    if (!model || model.id === task?.model?.id) return;
    doSwitchModel(model);
  }, [doSwitchModel, models, task?.model?.id]);

  useEffect(() => {
    if (!id || (!interactive && !starting)) return;
    const timer = setInterval(async () => {
      try { const detail = await getTaskDetail(id); if (detail) setTask(detail); } catch { /* ignore */ }
    }, starting ? 3000 : POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [id, interactive, starting]);

  // stream 给的历史游标：只有「拿到可用 cursor」才算 seed 成功；ready 但 cursor 为空时不要占位，
  // 否则会同时挡住 loadEarlier（无 cursor）和下面的 REST 兜底。
  useEffect(() => {
    if (!interactive || cursorSeededRef.current) return;
    const hc = liveState?.historyCursor;
    if (hc?.ready && hc.cursor) {
      cursorSeededRef.current = true;
      setCursor(hc.cursor);
      setHasMore(!!hc.hasMore);
    }
  }, [interactive, liveState?.historyCursor]);

  // 兜底：发消息/取消走 new 模式（captureCursor=false）或 stream 没给可用游标时，cursor 一直为空、
  // 上滑加载历史失效。本轮结束（status=finished）后仍无 cursor，就用 REST 取一次游标补上。
  useEffect(() => {
    if (!interactive || !id || cursor || cursorSeededRef.current || restSeedingRef.current) return;
    if (liveState?.status !== 'finished') return;
    restSeedingRef.current = true;
    (async () => {
      try {
        const rounds = await getTaskRounds({ id, limit: ROUNDS_PER_FETCH });
        cursorSeededRef.current = true;
        setCursor(rounds.next_cursor);
        setHasMore(!!rounds.has_more && !!rounds.next_cursor);
      } catch { /* 允许下次重试 */ } finally { restSeedingRef.current = false; }
    })();
  }, [interactive, id, cursor, liveState?.status]);

  // 持久化上下文用量：只在收到有效 usage_update（size>0）时更新，避免新一轮 handler 清空后闪回空白。
  useEffect(() => {
    const c = liveState?.contextUsage;
    if (c && typeof c.size === 'number' && c.size > 0) {
      const used = c.used ?? 0, size = c.size;
      setLastCtx((prev) => (prev && prev.used === used && prev.size === size ? prev : { used, size }));
    }
  }, [liveState?.contextUsage]);
  // 切换任务时清空（路由复用同一组件实例时也能正确重置）。
  useEffect(() => { setLastCtx(null); }, [id]);

  const loadEarlier = useCallback(async () => {
    if (!id || !cursor || historyLoading || !hasMore) return;
    setHistoryLoading(true);
    try {
      const rounds = await getTaskRounds({ id, cursor, limit: ROUNDS_PER_FETCH });
      const decoded = decodeChunks(rounds.chunks ?? []);
      setHistoryMessages((prev) => [...decoded.messages, ...prev]);
      setCursor(rounds.next_cursor);
      setHasMore(!!rounds.has_more && !!rounds.next_cursor);
    } catch { /* ignore */ } finally { setHistoryLoading(false); }
  }, [cursor, hasMore, historyLoading, id]);

  // 游标就绪但还没加载过任何历史时，自动拉第一页。覆盖两种 onEndReached 失效的情况：
  // ①上滑早于游标 seed（滑动时 cursor 还没就绪，之后不会再触发）；②内容没铺满、onEndReached 不会触发。
  useEffect(() => {
    if (cursor && hasMore && !historyLoading && historyMessages.length === 0) void loadEarlier();
  }, [cursor, hasMore, historyLoading, historyMessages.length, loadEarlier]);

  // includeAttachments=false 用于快捷指令（继续 / 压缩等）：只发文字，不带、也不清空已暂存的图片。
  const handleSend = useCallback((text: string, includeAttachments = true) => {
    const body = text.trim();
    const ready = includeAttachments ? attachmentsRef.current.filter((a) => a.status === 'done' && a.url) : [];
    if (!id || (!body && ready.length === 0)) return;
    if (includeAttachments && attachmentsRef.current.some((a) => a.status === 'uploading')) { flashToast('图片还在上传中…'); return; }
    setInput('');
    if (includeAttachments) setAttachments([]);
    const atts = ready.map((a) => ({ url: a.url as string, filename: a.name }));
    const prevLive = liveStateRef.current?.messages ?? [];
    if (prevLive.length) setHistoryMessages((prev) => [...prev, ...prevLive]);
    clientRef.current?.disconnect();
    setSending(true);
    const client = TaskStreamClient.newRound(id, body, atts, {
      onState: (s) => { setLive(s); if (s.connectionState === 'connected') setSending(false); },
      onOpen: () => setSending(false), onClose: () => setSending(false), onError: () => setSending(false),
    });
    clientRef.current = client; client.connect();
  }, [id, setLive, flashToast]);

  // 选图 → 逐张上传（先占位预览，上传完回填 url）。受 MAX_ATTACHMENTS 张数限制。
  const onAttach = useCallback(async () => {
    const remaining = MAX_ATTACHMENTS - attachmentsRef.current.length;
    if (remaining <= 0) { flashToast(`最多 ${MAX_ATTACHMENTS} 张图片`); return; }
    let picked;
    try { picked = await pickImages(remaining); }
    catch { flashToast('无法打开相册'); return; }
    if (!picked.length) return;
    const items = picked.map((img) => ({ key: `a${(attachSeq.current += 1)}`, img }));
    setAttachments((prev) => [...prev, ...items.map(({ key, img }) => ({ key, localUri: img.uri, name: img.name, status: 'uploading' as const }))]);
    // 并发上传（各自独立的 presign+PUT；setAttachments 按 key 更新，完成顺序无关）。
    await Promise.all(items.map(async ({ key, img }) => {
      try {
        const up = await uploadImage(img);
        setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, status: 'done', url: up.url, name: up.filename } : a)));
      } catch (e) {
        setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, status: 'error' } : a)));
        flashToast(e instanceof Error ? e.message : '图片上传失败');
      }
    }));
  }, [flashToast]);

  const removeAttachment = useCallback((key: string) => {
    setAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);

  // 点对话里的图片 → 确认后保存（用户附件图 + AI 的 markdown 图都走这里）。
  // 优先存相册（需原生构建里有 expo-media-library）；不可用时回退系统分享。
  const onSaveImage = useCallback((url: string) => {
    if (!url) return;
    Alert.alert('保存图片', '保存这张图片？', [
      { text: '取消', style: 'cancel' },
      {
        text: '保存',
        onPress: async () => {
          try { await saveImageToAlbum(url); flashToast('已保存到相册'); }
          catch (e) { flashToast(e instanceof Error ? e.message : '保存失败'); }
        },
      },
    ]);
  }, [flashToast]);

  const handleCancel = useCallback(() => clientRef.current?.sendCancel(), []);
  const handleAnswer = useCallback((askId: string, answers: AnswerMap) => { clientRef.current?.sendReplyQuestion(askId, answers); }, []);

  // 倒置列表里原生选中不可用，长按消息改为弹出可选中文本的面板（在正常层里选词复制 / 复制全部）。
  const [copyText, setCopyText] = useState<string | null>(null);
  const onCopy = useCallback((text: string) => setCopyText(text), []);
  const onCopyAll = useCallback((text: string) => { void Clipboard.setStringAsync(text); flashToast('已复制'); setCopyText(null); }, [flashToast]);

  // 本任务是否有一个“已收起”的预览（用于把 composer 的「在线预览」条变成展开入口）
  const previewMinimized = !!preview && preview.taskId === id && preview.minimized;
  // 在应用内浏览器打开某个 URL（新建/切换全局预览）
  const openInBrowser = useCallback((url: string) => { setPreviewOpen(false); if (id) openPreviewUrl(url, id); }, [id, openPreviewUrl]);
  // 预览入口：多端口 → 始终弹出选择（这样开了一个之后还能换别的端口）；单端口且已收起 → 展开；否则直接打开。
  const openPreview = useCallback(() => {
    const accessible = previewPorts.filter((p) => p.access_url);
    if (accessible.length > 1) { setPreviewOpen(true); void refreshPorts(); return; }
    if (previewMinimized) { expandPreview(); return; }
    if (accessible.length === 1) { openInBrowser(accessible[0].access_url!); return; }
    setPreviewOpen(true);
    void refreshPorts();
  }, [previewMinimized, previewPorts, expandPreview, openInBrowser, refreshPorts]);

  // 语音转写：识别文本实时写回输入框（保留点击麦克风前已有的内容作为前缀）。
  const speechBaseRef = useRef('');
  const speech = useSpeechToText({
    onText: (text) => setInput(speechBaseRef.current + text),
    onError: (msg) => flashToast(msg),
  });
  const onMic = useCallback(() => {
    setInput((cur) => {
      if (speech.status === 'idle') speechBaseRef.current = cur ? (cur.endsWith(' ') ? cur : cur + ' ') : '';
      return cur;
    });
    speech.toggle();
  }, [speech]);

  const doRestart = useCallback(async (loadSession: boolean) => {
    const control = controlRef.current;
    if (!control || !control.connected) { flashToast('控制通道未就绪，请稍候重试'); return; }
    setRestartBusy(loadSession ? 'restart' : 'reset');
    const resp = await control.restart(loadSession);
    setRestartBusy(null);
    if (resp?.success) flashToast(loadSession ? '已重启 Agent' : '已重启并清空上下文');
    else flashToast(resp?.message || resp?.error || '操作失败，请重试');
  }, [flashToast]);

  const onCmd = useCallback((key: CmdKey) => {
    if (restartBusy) return;
    if (key === 'continue') handleSend('继续', false);
    else if (key === 'compact') handleSend('/compact', false);
    else if (key === 'skill') {
      if ((liveStateRef.current?.availableCommands?.length ?? 0) === 0) { flashToast('当前没有可用技能指令'); return; }
      setSkillPickerOpen(true);
    }
    else if (key === 'restart') doRestart(true);
    else if (key === 'reset') {
      Alert.alert('重启并清空上下文', '将清空当前对话上下文并重启 Agent，确定继续？', [
        { text: '取消', style: 'cancel' },
        { text: '清空并重启', style: 'destructive', onPress: () => doRestart(false) },
      ]);
    }
  }, [restartBusy, handleSend, doRestart]);

  const liveMessages = liveState?.messages ?? [];
  const messages = useMemo(() => [...historyMessages, ...liveMessages], [historyMessages, liveMessages]);
  // 倒置列表：最新在前（视觉底部）。新消息进 data[0]（底部）、历史从 data 末尾（视觉顶部）追加。
  // 初始定位底部、流式吸底、上滑加载历史、展开 toolcall 都由 inverted 天然处理，无需手动 scrollToEnd。
  const reversed = useMemo(() => messages.slice().reverse(), [messages]);

  const streamConnected = liveState?.connectionState === 'connected';
  const roundRunning = streamConnected && liveState?.status === 'connected';
  // 本轮执行起始时间：取当前流中第一条用户消息的时间（对齐 web 的 executionStartedAt）。
  const roundStartMs = useMemo(() => {
    if (!roundRunning) return null;
    const raw = liveMessages.find((m) => m.kind === 'user')?.time ?? liveMessages[0]?.time;
    if (!raw) return null;
    return raw > 1e12 ? raw : raw * 1000; // 秒 → 毫秒
  }, [roundRunning, liveMessages]);

  const canAnswer = !!interactive && !!streamConnected;
  const canSwitchModel = !!interactive && !roundRunning && models.length > 0;
  const anyUploading = attachments.some((a) => a.status === 'uploading');
  const canSend = !!input.trim() || attachments.some((a) => a.status === 'done');
  const title = task ? taskDisplayName(task, '任务详情') : '任务详情';

  // 上下文用量是“事件驱动”的：仅当收到 usage_update（size>0）时才更新；新一轮会重建 handler 把
  // contextUsage 清空，所以这里把最近一次有效用量持久化在组件里，发消息/换轮时不再闪回空白。
  const ctxPct = lastCtx ? Math.min(1, Math.max(0, lastCtx.used / lastCtx.size)) : 0;
  const modelName = modelDisplayName(task?.model) || '对话';
  const tokens = task?.stats?.total_tokens;

  const availableCommands = liveState?.availableCommands ?? [];
  const pickSkill = useCallback((name: string) => {
    setSkillPickerOpen(false);
    const cmd = (liveStateRef.current?.availableCommands ?? []).find((c) => c.name === name);
    setInput(`/${name}${cmd?.input?.hint ? ' ' : ''}`);
  }, []);

  const AgentHeader = (
    <Glass border style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 45, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}
      // measure height for list top padding
    >
      <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
        <View style={{ height: insets.top }} />
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
          <IconButton icon="back" onPress={() => router.back()} />
          <Text numberOfLines={1} style={{ position: 'absolute', left: 56, right: 56, textAlign: 'center', fontSize: 16, fontWeight: '700', color: t.tx }}>{title}</Text>
          <View style={{ flex: 1 }} />
          {(interactive || fileChanges.length > 0) ? (
            <Pressable onPress={() => { setFilesOpen(true); refreshChanges(); }} hitSlop={6} style={{ padding: 8 }}>
              {/* 代码文件（文件 / 变动）；有改动时高亮。预览是 composer 上方的独立入口 */}
              <Icons.folder size={21} color={fileChanges.length > 0 ? t.ac : t.tx2} sw={1.9} />
            </Pressable>
          ) : null}
        </View>
        {/* agent status strip（精简：状态环/对勾 + 模型，去掉状态文案）*/}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.pad, paddingBottom: 9 }}>
          {!interactive ? (
            <View style={{ width: 24, height: 24, borderRadius: 99, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
              <Icons.checkCircle size={15} color={t.acTx} sw={2} />
            </View>
          ) : (
            // interactive：始终展示上下文环（还没有 usage_update 时即为 0%），不再有 loading/绿点
            <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
              <Ring value={ctxPct} size={24} sw={2.6} color={ctxColor(ctxPct, t)} />
              <Text style={{ position: 'absolute', fontFamily: 'monospace', fontSize: 8, fontWeight: '700', color: ctxColor(ctxPct, t) }}>{Math.round(ctxPct * 100)}</Text>
            </View>
          )}
          <Pressable onPress={() => canSwitchModel && setModelPickerOpen(true)} disabled={!canSwitchModel}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingHorizontal: canSwitchModel ? 9 : 0, paddingVertical: canSwitchModel ? 4 : 0, borderRadius: 99, backgroundColor: canSwitchModel ? t.bg3 : 'transparent' }}>
            {switching ? <Spinner size={12} color={t.acTx} sw={1.8} /> : <ModelIcon model={task?.model?.model} size={15} />}
            <Text numberOfLines={1} style={{ color: t.tx2, fontSize: 12, fontWeight: '500', flexShrink: 1 }}>{modelName}</Text>
            {canSwitchModel ? <Icons.chevron size={12} color={t.tx3} sw={2} style={{ transform: [{ rotate: '90deg' }] }} /> : null}
          </Pressable>
          {tokens ? <Text style={{ marginLeft: 'auto', paddingLeft: 8, color: t.tx3, fontSize: 11.5, fontFamily: 'monospace', flexShrink: 0 }}>{formatTokens(tokens)} tokens</Text> : null}
        </View>
      </View>
    </Glass>
  );

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }}><LoadingView label="加载任务详情…" /></View>;
  if (error && !task) return <View style={{ flex: 1, backgroundColor: t.bg }}><EmptyView title="加载失败" subtitle={error} icon="alert" /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior="padding">
      <View style={{ flex: 1 }}>
        {starting ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, paddingTop: headerH }}>
            {startCond?.failed
              ? <Icons.alert size={30} color={t.red} sw={2.2} />
              : <Spinner size={30} color={t.ac} sw={2.4} />}
            <Text style={{ color: startCond?.failed ? t.red : t.tx, fontSize: 17, fontWeight: '600' }}>{startCond?.label ?? '任务正在启动…'}</Text>
            <Text style={{ color: t.tx2, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
              {startCond?.message || '正在准备云开发环境，启动完成后即可开始对话'}
            </Text>
          </View>
        ) : messages.length === 0 ? (
          interactive ? <View style={{ flex: 1, paddingTop: headerH }}><LoadingView label="连接对话中…" /></View>
            : <View style={{ flex: 1, paddingTop: headerH }}><EmptyView title="暂无对话" subtitle="该任务没有可展示的对话记录" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={reversed}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <StreamBlock message={item} canAnswer={canAnswer} onAnswer={handleAnswer} onCopy={onCopy} onSaveImage={onSaveImage} />}
            ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
            // inverted 下：paddingTop=视觉底部（贴近 composer），paddingBottom=视觉顶部（避开浮动 header）。
            contentContainerStyle={{ paddingTop: 14, paddingBottom: headerH + 12, paddingHorizontal: spacing.pad }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onEndReached={loadEarlier}
            onEndReachedThreshold={0.4}
            // inverted 下 ListFooterComponent 渲染在视觉顶部 → 放“加载更早历史”的转圈。
            ListFooterComponent={historyLoading ? <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator size="small" color={t.tx2} /></View> : null}
            // 关键：生成时流式消息在 reversed[0]（底部）。minIndexForVisible:0 让底部消息“长高”时
            // 补偿滚动偏移，用户上滑查看时视图不被往下拽；autoscrollToTopThreshold 仅在贴近底部时才自动吸底。
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 120 }}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={11}
          />
        )}
        {AgentHeader}
      </View>

      {/* composer / ended bar */}
      {interactive ? (
        <Glass border style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.pad, paddingTop: 11, paddingBottom: insets.bottom + 12 }}>
          {previewPorts.length > 0 ? (
            // 在线预览入口：开发环境一旦监听端口就出现在输入框正上方，醒目、高频、一步直达。
            <Pressable onPress={openPreview} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.acGhost, borderWidth: 1, borderColor: t.acLine, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10 }, pressed && { opacity: 0.7 }]}>
              <Icons.globe size={16} color={t.acTx} sw={2} />
              <Text style={{ color: t.acTx, fontSize: 13, fontWeight: '700' }}>在线预览</Text>
              <Text numberOfLines={1} style={{ flex: 1, color: t.tx3, fontSize: 12, fontFamily: 'monospace' }}>
                {previewPorts.length === 1 ? `端口 ${previewPorts[0].port}` : `端口 ${previewPorts.slice(0, 2).map((p) => p.port).join(' · ')}${previewPorts.length > 2 ? ` +${previewPorts.length - 2}` : ''}`}
              </Text>
              {previewPorts.length > 1 ? <View style={{ minWidth: 18, height: 18, borderRadius: 99, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={{ fontSize: 10.5, fontWeight: '800', color: t.acInk }}>{previewPorts.length}</Text></View> : null}
              <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '700' }}>{previewPorts.length > 1 ? '选择' : previewMinimized ? '展开' : '访问'}</Text>
              {(previewMinimized && previewPorts.length <= 1)
                ? <Icons.chevron size={14} color={t.acTx} sw={2.4} style={{ transform: [{ rotate: '-90deg' }] }} />
                : <Icons.arrowRight size={13} color={t.acTx} sw={2.4} />}
            </Pressable>
          ) : null}
          {roundRunning ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9, paddingVertical: 2 }}>
              <Spinner size={14} color={t.acTx} sw={2.2} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '600' }}>AI 正在处理</Text>
                <TypingDots color={t.acTx} />
              </View>
              {roundStartMs ? <RunTimer startMs={roundStartMs} style={{ marginLeft: 'auto', color: t.tx3 }} /> : null}
            </View>
          ) : speech.active ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9, paddingVertical: 2 }}>
              {speech.status === 'connecting' || speech.status === 'stopping'
                ? <Spinner size={14} color={t.acTx} sw={2.2} />
                : <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.red }} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '600' }}>
                  {speech.status === 'connecting' ? '正在连接语音服务' : speech.status === 'stopping' ? '正在转写' : '正在录音，点击结束'}
                </Text>
                {speech.status === 'connecting' || speech.status === 'stopping' ? <TypingDots color={t.acTx} /> : null}
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 9 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ gap: 7, paddingRight: 8, alignItems: 'center' }}>
                {QUICK_PROMPTS.map((p) => (
                  <Pressable key={p.label} disabled={!!restartBusy || sending} onPress={() => handleSend(p.text, false)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, backgroundColor: t.acGhost, opacity: (restartBusy || sending) ? 0.5 : 1 }}>
                    <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '600' }}>{p.label}</Text>
                  </Pressable>
                ))}
                {DIRECT_COMMANDS.map((c) => {
                  const tone = cmdTone(c.tone, t);
                  return (
                    <Pressable key={c.key} disabled={!!restartBusy} onPress={() => onCmd(c.key)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, backgroundColor: tone.bg, opacity: restartBusy ? 0.5 : 1 }}>
                      <Text style={{ color: tone.color, fontSize: 12.5, fontWeight: '600' }}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {/* ⋯ 更多 固定在最右侧，不随快捷方式横向滚动 */}
              <Pressable disabled={!!restartBusy} onPress={() => setMoreOpen(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, backgroundColor: t.bg4, marginLeft: 8, opacity: restartBusy ? 0.5 : 1 }}>
                {restartBusy ? <Spinner size={13} color={t.tx2} sw={2} /> : <Icons.more size={17} color={t.tx2} sw={2} />}
                <Text style={{ color: t.tx2, fontSize: 12.5, fontWeight: '600' }}>更多</Text>
              </Pressable>
            </View>
          )}
          {attachments.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 9 }} contentContainerStyle={{ gap: 10, paddingTop: 6, paddingRight: 6 }}>
              {attachments.map((a) => (
                <View key={a.key} style={{ width: 60, height: 60 }}>
                  <Image source={{ uri: a.localUri }} style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: t.bg3, opacity: a.status === 'done' ? 1 : 0.55 }} />
                  {a.status === 'uploading' ? (
                    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 10 }]}>
                      <Spinner size={18} color="#fff" sw={2.2} />
                    </View>
                  ) : a.status === 'error' ? (
                    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.redGhost, borderWidth: 1, borderColor: t.red, borderRadius: 10 }]}>
                      <Icons.alert size={18} color={t.red} sw={2} />
                    </View>
                  ) : null}
                  <Pressable onPress={() => removeAttachment(a.key)} hitSlop={8}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 99, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: t.tx2, fontSize: 14, lineHeight: 16, fontWeight: '700' }}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.bg2, borderWidth: 1, borderColor: (inputFocused || speech.active) ? t.ac : t.line2, borderRadius: 22, paddingLeft: 10, paddingRight: 6, minHeight: 44, opacity: roundRunning ? 0.6 : 1 }}>
              <Pressable onPress={onAttach} disabled={roundRunning || sending || attachments.length >= MAX_ATTACHMENTS} hitSlop={8} style={{ paddingVertical: 4, paddingHorizontal: 2 }}>
                <Icons.attach size={20} color={attachments.length >= MAX_ATTACHMENTS ? t.line2 : t.tx3} sw={1.8} />
              </Pressable>
              <TextInput value={input} onChangeText={setInput} editable={!roundRunning && !sending && !speech.active}
                onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
                placeholder={speech.active ? '请说话…' : roundRunning ? '' : '继续这个任务…'} placeholderTextColor={speech.active ? t.acTx : t.tx3}
                multiline style={{ flex: 1, color: t.tx, fontSize: 15, paddingVertical: 11, maxHeight: 120 }} />
              <MicButton status={speech.status} active={speech.active} onPress={onMic} disabled={roundRunning} idleColor={t.tx3} />
            </View>
            <Pressable
              onPress={roundRunning ? handleCancel : () => { if (speech.active) speech.stop(true); handleSend(input); }}
              disabled={roundRunning ? false : (!canSend || sending || anyUploading)}
              style={{ width: 44, height: 44, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: roundRunning ? t.red : canSend ? t.ac : t.bg3 }}>
              {roundRunning ? <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: '#fff' }} /> : sending ? <ActivityIndicator size="small" color={t.acInk} /> : <Icons.send size={20} color={canSend ? t.acInk : t.tx3} sw={2.2} />}
            </Pressable>
          </View>
        </Glass>
      ) : starting ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.bg2 }}>
          <Spinner size={15} color={t.ac} sw={2.2} /><Text style={{ color: t.tx2, fontSize: 13 }}>任务正在启动，请稍候</Text><TypingDots color={t.tx2} />
        </View>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 14, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.bg2 }}>
          <Text style={{ color: t.tx3, fontSize: 13 }}>任务已结束，无法继续对话</Text>
        </View>
      )}

      <ModelSheet visible={modelPickerOpen} title="切换模型" models={models} selectedId={task?.model?.id ?? ''} onPick={requestSwitchModel} onClose={() => setModelPickerOpen(false)} />
      <SkillSheet visible={skillPickerOpen} commands={availableCommands} onPick={pickSkill} onClose={() => setSkillPickerOpen(false)} />
      <FilesPanel visible={filesOpen} onClose={() => setFilesOpen(false)} control={controlRef.current} initialChanges={fileChanges} vmId={task?.virtualmachine?.id} />
      <PreviewSheet visible={previewOpen} ports={previewPorts} refreshing={portsRefreshing} activeUrl={preview && preview.taskId === id ? preview.url : undefined} onOpen={openInBrowser} onRefresh={refreshPorts} onClose={() => setPreviewOpen(false)} />
      <CopySheet visible={copyText != null} text={copyText ?? ''} onClose={() => setCopyText(null)} onCopyAll={onCopyAll} />

      {/* AI 数据处理同意：进入可交互（可对话）任务且未同意时弹出，未同意则退出该页 */}
      <AiConsentModal visible={interactive && aiConsent.status === 'needed'} onAgree={aiConsent.grant} onDecline={() => router.back()} />

      {/* ⋯ 更多操作：低频/破坏性指令，点开后选择，避免误触 */}
      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)} statusBarTranslucent>
        <Scrim onPress={() => setMoreOpen(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.bg2, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 14, ...t.shLift }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 8 }} />
          <Text style={{ paddingHorizontal: 18, paddingBottom: 6, fontSize: 17, fontWeight: '700', color: t.tx }}>更多操作</Text>
          <View style={{ paddingHorizontal: 12, paddingTop: 2 }}>
            {MORE_COMMANDS.map((c) => {
              const tone = cmdTone(c.tone, t);
              const I = c.icon ? Icons[c.icon] : null;
              return (
                <Pressable key={c.key} onPress={() => { setMoreOpen(false); onCmd(c.key); }}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 13 }, pressed && { backgroundColor: t.bg3 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
                    {I ? <I size={18} color={tone.color} sw={1.9} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: c.tone === 'red' ? t.red : t.tx }}>{c.label}</Text>
                    {c.desc ? <Text style={{ fontSize: 12, color: t.tx3, marginTop: 2 }}>{c.desc}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {toast ? <Toast text={toast} bottom={insets.bottom + 96} /> : null}
    </KeyboardAvoidingView>
  );
}
