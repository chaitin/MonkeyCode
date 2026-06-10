import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, createTask, getSubscription, listImages, listModels, listProjects } from '@/api/client';
import { AiConsentModal, useAiConsent } from '@/components/AiConsent';
import type { Model, Project } from '@/api/types';
import { ConcurrentLimitModal } from '@/components/ConcurrentLimitModal';
import { Icons, providerIconForUrl } from '@/components/Icons';
import { MicButton } from '@/components/MicButton';
import { ModelSheet } from '@/components/sheets';
import { Card, IconButton, MonkeyLogo, PickerSheet, PrimaryButton, type PickerOption } from '@/components/ui';
import { useSpeechToText } from '@/speech/useSpeechToText';
import { DEFAULT_SKILL_IDS, modelLabel, pickDefaultImage, pickDefaultModel, TASK_DEFAULTS } from '@/config';
import { spacing, useTheme, type Theme } from '@/theme';

const SUGGESTIONS = ['修复一个线上 bug', '为这个仓库写单元测试', '重构这个模块', '解释这段代码做了什么'];

function ConfigRow({ icon, label, value, sub, divider, onPress, t }: { icon: string; label: string; value: string; sub?: string; divider?: boolean; onPress: () => void; t: Theme }) {
  const I = Icons[icon];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13, borderTopWidth: divider ? 1 : 0, borderColor: t.line }, pressed && { backgroundColor: t.bg3 }]}>
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
        <I size={17} color={t.acTx} sw={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: t.tx3, fontWeight: '500' }}>{label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: t.tx, marginTop: 1 }}>{value}</Text>
      </View>
      {sub ? <Text numberOfLines={1} style={{ fontFamily: 'monospace', fontSize: 12, color: t.tx3, maxWidth: 120, marginRight: 4 }}>{sub}</Text> : null}
      <Icons.chevron size={17} color={t.tx3} sw={1.9} />
    </Pressable>
  );
}

export default function NewTaskScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const aiConsent = useAiConsent(); // 新建任务会把内容发给 AI，需先取得数据处理同意（App Store 2.1）
  const params = useLocalSearchParams<{ repo?: string; repoName?: string; projectId?: string }>();

  const [models, setModels] = useState<Model[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [content, setContent] = useState('');
  const [modelId, setModelId] = useState('');
  const [imageId, setImageId] = useState('');
  const [repoKey, setRepoKey] = useState<string>(params.projectId || ''); // '' = 不关联仓库；否则为 project.id

  const [picking, setPicking] = useState<'repo' | 'model' | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 语音输入：识别文本写回任务描述（保留点麦克风前已有内容作前缀）
  const speechBaseRef = useRef('');
  const speech = useSpeechToText({
    onText: (text) => setContent(speechBaseRef.current + text),
    onError: (msg) => setError(msg),
  });
  const onMic = () => {
    if (speech.status === 'idle') speechBaseRef.current = content && !/\s$/.test(content) ? content + ' ' : content;
    speech.toggle();
  };

  useEffect(() => {
    (async () => {
      try {
        const [m, imgs, projRes, sub] = await Promise.all([
          listModels(),
          listImages(),
          listProjects({ limit: 50 }).catch(() => ({ projects: [] as Project[], hasMore: false })),
          getSubscription().catch(() => null),
        ]);
        setModels(m);
        setModelId(pickDefaultModel(m, sub?.plan));
        setImageId(pickDefaultImage(imgs));
        setProjects(projRes.projects);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.message : '加载配置失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedModel = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === repoKey), [projects, repoKey]);

  const repoOptions: PickerOption[] = [
    { key: '', title: '快速开始', sub: '不关联仓库', icon: 'sparkle' },
    ...projects.map((p, i) => ({ key: p.id || `p${i}`, title: p.name || p.full_name || '项目', sub: p.repo_url, icon: providerIconForUrl(p.repo_url) })),
  ];

  const submit = useCallback(async () => {
    setError('');
    if (!content.trim()) { setError('请描述你想让 AI 做什么'); return; }
    if (!modelId) { setError('请选择模型'); return; }
    setSubmitting(true);
    try {
      const repo = selectedProject ? { repo_url: selectedProject.repo_url || undefined } : {};
      const task = await createTask({
        content: content.trim(),
        cli_name: TASK_DEFAULTS.cliName,
        model_id: modelId,
        host_id: TASK_DEFAULTS.hostId,
        image_id: imageId,
        task_type: 'develop',
        repo,
        resource: { ...TASK_DEFAULTS.resource },
        extra: { skill_ids: DEFAULT_SKILL_IDS, project_id: selectedProject?.id },
      });
      if (task?.id) router.replace(`/task/${task.id}`);
      else setError('任务创建成功但未返回 ID');
    } catch (e) {
      if (e instanceof ApiError && e.code === 10811) setLimitOpen(true);
      else setError(e instanceof ApiError ? e.message : '任务创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [content, imageId, modelId, router, selectedProject]);

  // 仓库行只展示一处信息，避免「快速开始 / 不关联仓库」「名字 / 同名仓库路径」这种左右重复。
  const repoValue = selectedProject ? (selectedProject.full_name || selectedProject.name || '项目') : '不关联仓库';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior="padding">
      {/* top bar */}
      {/* iOS 是 modal 卡片（已在状态栏下方），不要再叠加 insets.top，否则标题上方一大片空白；Android 是全屏，需要状态栏内边距 */}
      <View style={{ paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 6 }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
          <View style={{ width: 38 }} />
          <Text style={{ position: 'absolute', left: 56, right: 56, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.tx }}>新建任务</Text>
          <View style={{ marginLeft: 'auto' }}>
            <IconButton icon="plus" onPress={() => router.back()} iconSize={24} sw={2} style={{ transform: [{ rotate: '45deg' }] }} />
          </View>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ac} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 14, paddingBottom: insets.bottom + 100 }} keyboardShouldPersistTaps="handled">
          {/* headline */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <MonkeyLogo size={40} />
            <Text style={{ fontSize: 18, fontWeight: '800', letterSpacing: -0.3, color: t.tx }}>你想让我做什么呢？</Text>
          </View>

          {/* config */}
          <Card style={{ overflow: 'hidden', marginBottom: 14 }}>
            <ConfigRow icon="folder" label="代码仓库" value={repoValue} onPress={() => setPicking('repo')} t={t} />
            <ConfigRow icon="cube" label="模型" value={selectedModel ? modelLabel(selectedModel) : '选择模型'} divider onPress={() => setPicking('model')} t={t} />
          </Card>

          {/* describe */}
          <Card style={{ padding: 15, marginBottom: 14 }}>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder={speech.active ? '请说话…' : '描述任务，比如：修复登录页 token 刷新失效的问题，并补充测试…'}
              placeholderTextColor={speech.active ? t.acTx : t.tx3}
              multiline
              style={{ minHeight: 110, color: t.tx, fontSize: 15.5, lineHeight: 22, textAlignVertical: 'top', paddingRight: 40, paddingBottom: 34 }}
              editable={!submitting && !speech.active}
            />
            {/* 右下角语音输入 */}
            <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
              <MicButton status={speech.status} active={speech.active} onPress={onMic} disabled={submitting} idleBg={t.bg4} idleColor={t.tx2} />
            </View>
          </Card>

          {/* suggestions */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5, marginBottom: 10 }}>试试这些</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} onPress={() => setContent(s)} style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 11, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line }}>
                <Text style={{ color: t.tx2, fontSize: 13.5, fontWeight: '500' }}>{s}</Text>
              </Pressable>
            ))}
          </View>

          {loadError ? <Text style={{ color: t.red, fontSize: 13, marginTop: 14 }}>{loadError}</Text> : null}
          {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 14 }}>{error}</Text> : null}
        </ScrollView>
      )}

      {/* footer action */}
      {!loading ? (
        <View style={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.bg }}>
          <PrimaryButton block icon={submitting ? undefined : 'send'} label={submitting ? '正在创建…' : '发起任务'} disabled={submitting || !content.trim()} onPress={submit} />
        </View>
      ) : null}

      <PickerSheet visible={picking === 'repo'} title="选择仓库" options={repoOptions} selected={repoKey}
        onPick={(k) => { setRepoKey(k); setPicking(null); }} onClose={() => setPicking(null)} />
      <ModelSheet visible={picking === 'model'} models={models} selectedId={modelId}
        onPick={(k) => { setModelId(k); setPicking(null); }} onClose={() => setPicking(null)} />
      <ConcurrentLimitModal visible={limitOpen} onClose={() => setLimitOpen(false)} onStopped={() => { setLimitOpen(false); setTimeout(() => submit(), 400); }} />

      {/* AI 数据处理同意：新建任务会把内容发给 AI，未同意则退出 */}
      <AiConsentModal visible={aiConsent.status === 'needed'} onAgree={aiConsent.grant} onDecline={() => router.back()} />
    </KeyboardAvoidingView>
  );
}
