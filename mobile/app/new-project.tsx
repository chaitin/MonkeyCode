/**
 * 新建项目 —— 对齐 Web add-project.tsx：选一个已绑定的 Git 账号 → 从该身份有权访问的仓库里
 * 选择（支持搜索，也可手动填仓库地址）→ 起个项目名 → 创建。创建成功进入项目详情。
 *
 * 移动端取舍（非照搬 Web 的弹窗下拉）：
 *  - 身份用底部 PickerSheet 选择；
 *  - 仓库用全屏可搜索面板（授权仓库可能很多，全屏比下拉更顺手），并内置「手动输入仓库地址」。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, createProject, getGitIdentity, listGitIdentities } from '@/api/client';
import type { AuthRepository, GitIdentity } from '@/api/types';
import { Icons, providerIcon, providerIconForUrl } from '@/components/Icons';
import { RepoUrlSheet } from '@/components/sheets';
import { Card, EmptyView, IconButton, LoadingView, PickerSheet, PrimaryButton, type PickerOption } from '@/components/ui';
import { gitPlatformLabel } from '@/git';
import { spacing, useTheme, type Theme } from '@/theme';

/** 从 owner/repo 或 Git 地址里取一个简短项目名。 */
function repoShortName(fullName?: string, url?: string): string {
  const fn = (fullName || '').trim();
  if (fn) return fn.split('/').filter(Boolean).pop() || fn;
  const cleaned = (url || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  return cleaned.split(/[/:]/).filter(Boolean).pop() || '';
}

function ConfigRow({ icon, label, value, placeholder, onPress, divider, t }: { icon: string; label: string; value?: string; placeholder: string; onPress: () => void; divider?: boolean; t: Theme }) {
  const I = Icons[icon] ?? Icons.git;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13, borderTopWidth: divider ? 1 : 0, borderColor: t.line }, pressed && { backgroundColor: t.bg3 }]}>
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
        <I size={17} color={t.acTx} sw={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: t.tx3, fontWeight: '500' }}>{label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: value ? t.tx : t.tx3, marginTop: 1 }}>{value || placeholder}</Text>
      </View>
      <Icons.chevron size={17} color={t.tx3} sw={1.9} />
    </Pressable>
  );
}

/** 全屏可搜索仓库选择面板。 */
function RepoPickerModal({ visible, repos, loading, error, selectedUrl, onPick, onManual, onRefresh, onClose, t }: {
  visible: boolean; repos: AuthRepository[]; loading: boolean; error: string; selectedUrl: string;
  onPick: (r: AuthRepository) => void; onManual: () => void; onRefresh: () => void; onClose: () => void; t: Theme;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  // 打开时清空搜索词
  const [wasOpen, setWasOpen] = useState(visible);
  if (visible !== wasOpen) { setWasOpen(visible); if (visible) setQuery(''); }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => `${r.full_name || ''} ${r.url || ''} ${r.description || ''}`.toLowerCase().includes(q));
  }, [repos, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ paddingTop: insets.top, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
          <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
            <View style={{ width: 40 }} />
            <Text style={{ flex: 1, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.tx }}>选择仓库</Text>
            <Pressable onPress={onRefresh} hitSlop={8} style={{ padding: 8 }} disabled={loading}>
              <Icons.refresh size={20} color={loading ? t.tx3 : t.tx2} sw={2} />
            </Pressable>
            <IconButton icon="plus" onPress={onClose} iconSize={24} sw={2} style={{ transform: [{ rotate: '45deg' }] }} />
          </View>
          {/* search */}
          <View style={{ paddingHorizontal: spacing.pad, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: t.bg3, borderRadius: 12, paddingHorizontal: 13, height: 42 }}>
              <Icons.search size={17} color={t.tx3} sw={1.9} />
              <TextInput value={query} onChangeText={setQuery} placeholder="搜索仓库名称" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: t.tx, fontSize: 14.5 }} />
              {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Icons.plus size={16} color={t.tx3} sw={2} style={{ transform: [{ rotate: '45deg' }] }} /></Pressable> : null}
            </View>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 20 }} keyboardShouldPersistTaps="handled">
            {/* 手动输入入口（始终置顶） */}
            <Pressable onPress={onManual} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 13, marginBottom: 4 }, pressed && { backgroundColor: t.bg3 }]}>
              <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
                <Icons.edit size={17} color={t.acTx} sw={1.8} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>手动输入仓库地址</Text>
                <Text style={{ fontSize: 11.5, color: t.tx3, marginTop: 2 }}>列表里没有？直接填写 Git 仓库地址</Text>
              </View>
              <Icons.chevron size={16} color={t.tx3} sw={1.9} />
            </Pressable>

            {loading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={t.ac} /></View>
            ) : error ? (
              <View style={{ paddingVertical: 36, alignItems: 'center', gap: 10, paddingHorizontal: 30 }}>
                <Icons.alert size={24} color={t.tx3} sw={1.8} />
                <Text style={{ color: t.tx3, fontSize: 13, textAlign: 'center' }}>{error}</Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={{ paddingVertical: 36, alignItems: 'center', gap: 8 }}>
                <Text style={{ color: t.tx3, fontSize: 13 }}>{repos.length === 0 ? '该账号暂无可访问的仓库' : '没有匹配的仓库'}</Text>
              </View>
            ) : (
              filtered.map((r, i) => {
                const on = !!r.url && r.url === selectedUrl;
                const I = Icons[providerIconForUrl(r.url)] ?? Icons.git;
                return (
                  <Pressable key={r.url || `${r.full_name}-${i}`} onPress={() => onPick(r)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 13, marginBottom: 2, backgroundColor: on ? t.acGhost : 'transparent' }, pressed && !on && { backgroundColor: t.bg3 }]}>
                    <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
                      <I size={18} color={t.tx2} sw={1.8} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>{r.full_name || r.url}</Text>
                      {r.description ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 2 }}>{r.description}</Text> : null}
                    </View>
                    {on ? <Icons.check size={18} color={t.acTx} sw={2.4} /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default function NewProjectScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [identities, setIdentities] = useState<GitIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [identityId, setIdentityId] = useState('');
  const [repos, setRepos] = useState<AuthRepository[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [name, setName] = useState('');
  const autoNameRef = React.useRef(''); // 上次自动带出的名字，用户没改过才跟随仓库更新

  const [picking, setPicking] = useState(false); // 身份选择
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 进入 / 从绑定页返回时刷新身份列表
  useFocusEffect(
    useCallback(() => {
      let active = true;
      listGitIdentities()
        .then((list) => { if (active) setIdentities(list); })
        .catch((e) => { if (active) setLoadError(e instanceof ApiError ? e.message : '加载失败'); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, []),
  );

  const selectedIdentity = useMemo(() => identities.find((i) => i.id === identityId), [identities, identityId]);

  const loadRepos = useCallback(async (id: string, flush = false) => {
    setReposLoading(true);
    setReposError('');
    try {
      const detail = await getGitIdentity(id, flush);
      setRepos(detail?.authorized_repositories ?? []);
    } catch (e) {
      setReposError(e instanceof ApiError ? e.message : '获取仓库失败');
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, []);

  const onPickIdentity = useCallback((id: string) => {
    setPicking(false);
    if (id === identityId) return;
    setIdentityId(id);
    // 切换身份后清空已选仓库并重新加载
    setRepoUrl('');
    setRepos([]);
    void loadRepos(id);
  }, [identityId, loadRepos]);

  // 选中仓库后：带出项目名（用户没手动改过才覆盖）。
  // 注意：先把上一次自动名存进局部常量再改 ref —— setName 的函数式更新器延迟到渲染时才跑，
  // 若直接读 autoNameRef.current 会读到刚写入的新值，导致切换仓库时不覆盖旧的自动名。
  const applyRepo = useCallback((url: string, fullName?: string) => {
    setRepoUrl(url);
    const short = repoShortName(fullName, url);
    const prevAuto = autoNameRef.current;
    autoNameRef.current = short;
    setName((cur) => (cur.trim() === '' || cur === prevAuto ? short : cur));
  }, []);

  const identityOptions: PickerOption[] = useMemo(
    () => identities.map((i) => ({
      key: i.id || '',
      title: i.remark?.trim() || i.username || gitPlatformLabel(i.platform),
      sub: i.base_url,
      icon: providerIcon(i.platform),
    })),
    [identities],
  );

  const identityValue = selectedIdentity
    ? (selectedIdentity.remark?.trim() || selectedIdentity.username || gitPlatformLabel(selectedIdentity.platform))
    : '';
  const repoValue = repoUrl
    ? (repos.find((r) => r.url === repoUrl)?.full_name || repoShortName(undefined, repoUrl) || repoUrl)
    : '';

  const submit = useCallback(async () => {
    setError('');
    if (!identityId) { setError('请选择 Git 账号'); return; }
    if (!repoUrl.trim()) { setError('请选择或填写代码仓库'); return; }
    if (!name.trim()) { setError('请填写项目名称'); return; }
    setSubmitting(true);
    try {
      const project = await createProject({
        name: name.trim(),
        platform: selectedIdentity?.platform,
        git_identity_id: identityId,
        repo_url: repoUrl.trim(),
      });
      if (project?.id) router.replace(`/project/${project.id}`);
      else router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建项目失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [identityId, repoUrl, name, selectedIdentity, router]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior="padding">
      {/* top bar（push 全屏：iOS / Android 都需让开状态栏） */}
      <View style={{ paddingTop: insets.top + 6 }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
          <View style={{ width: 38 }} />
          <Text style={{ position: 'absolute', left: 56, right: 56, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.tx }}>新建项目</Text>
          <View style={{ marginLeft: 'auto' }}>
            <IconButton icon="plus" onPress={() => router.back()} iconSize={24} sw={2} style={{ transform: [{ rotate: '45deg' }] }} />
          </View>
        </View>
      </View>

      {loading ? (
        <LoadingView label="加载中…" />
      ) : identities.length === 0 ? (
        // 没有身份：引导先去绑定
        <View style={{ flex: 1 }}>
          <EmptyView icon="key" title="先绑定一个 Git 账号" subtitle={loadError || '创建项目需要关联代码仓库\n绑定 GitHub / GitLab / Gitee 等账号后即可选择'} />
          <View style={{ paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 20 }}>
            <PrimaryButton block label="去绑定 Git 账号" icon="link" onPress={() => router.push('/git-identities')} />
          </View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.pad, paddingTop: 14, paddingBottom: insets.bottom + 110 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 18, fontWeight: '800', letterSpacing: -0.3, color: t.tx, marginBottom: 16 }}>关联一个代码仓库</Text>

            <Card style={{ overflow: 'hidden', marginBottom: 14 }}>
              <ConfigRow icon="key" label="Git 账号" value={identityValue} placeholder="选择已绑定的账号" onPress={() => setPicking(true)} t={t} />
              <ConfigRow icon="folder" label="代码仓库" value={repoValue}
                placeholder={identityId ? '选择仓库' : '请先选择 Git 账号'}
                onPress={() => { if (!identityId) { setPicking(true); return; } setRepoPickerOpen(true); }} divider t={t} />
            </Card>

            <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginBottom: 8 }}>项目名称</Text>
            <TextInput value={name} onChangeText={(v) => { setName(v); }} placeholder="给项目起个名字" placeholderTextColor={t.tx3}
              editable={!submitting}
              style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, color: t.tx, fontSize: 15.5, ...t.shCard }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5 }}>没有合适的账号？</Text>
              <Pressable onPress={() => router.push('/git-identities')} hitSlop={6} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.6 }]}>
                <Icons.plus size={14} color={t.acTx} sw={2.2} />
                <Text style={{ fontSize: 13, color: t.acTx, fontWeight: '700' }}>管理 Git 账号</Text>
              </Pressable>
            </View>

            {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 16 }}>{error}</Text> : null}
          </ScrollView>

          <View style={{ paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.bg }}>
            <PrimaryButton block icon={submitting ? undefined : 'check'} label={submitting ? '正在创建…' : '创建项目'} disabled={submitting || !identityId || !repoUrl || !name.trim()} onPress={submit} />
          </View>
        </>
      )}

      {/* 身份选择 */}
      <PickerSheet visible={picking} title="选择 Git 账号" options={identityOptions} selected={identityId}
        onPick={onPickIdentity} onClose={() => setPicking(false)} />

      <RepoPickerModal
        visible={repoPickerOpen}
        repos={repos}
        loading={reposLoading}
        error={reposError}
        selectedUrl={repoUrl}
        onPick={(r) => { if (r.url) applyRepo(r.url, r.full_name); setRepoPickerOpen(false); }}
        onManual={() => { setRepoPickerOpen(false); setManualOpen(true); }}
        onRefresh={() => { if (identityId) void loadRepos(identityId, true); }}
        onClose={() => setRepoPickerOpen(false)}
        t={t}
      />

      <RepoUrlSheet visible={manualOpen} initialUrl={repoUrl}
        onConfirm={(u) => { applyRepo(u); setManualOpen(false); }}
        onClose={() => setManualOpen(false)} />
    </KeyboardAvoidingView>
  );
}
