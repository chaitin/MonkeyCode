/**
 * Git 账号管理 —— 对齐 Web「Git 平台身份凭证」（settings/identities.tsx）。
 * 列表展示已绑定身份，可删除；「添加 Git 账号」弹出方式选择：
 *  - GitHub / GitLab / Gitee / Gitea：一键 OAuth 授权（/git-oauth）。
 *  - 其他平台：手动填 Access Token（/git-identity-form）。
 * 身份是创建项目、让 AI 拉取/提交代码的前置条件。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, deleteGitIdentity, listGitIdentities } from '@/api/client';
import type { GitIdentity } from '@/api/types';
import { Icons, providerIcon } from '@/components/Icons';
import { Card, EmptyView, GlassNav, IconButton, LoadingView, PrimaryButton, PickerSheet, type PickerOption } from '@/components/ui';
import { gitPlatformLabel, OAUTH_PLATFORMS } from '@/git';
import { spacing, useTheme, type Theme } from '@/theme';

const MANUAL_KEY = '__manual__';

function IdentityRow({ identity, onPress, onDelete, divider, t }: { identity: GitIdentity; onPress: () => void; onDelete: () => void; divider: boolean; t: Theme }) {
  const Icon = Icons[providerIcon(identity.platform)] ?? Icons.git;
  const title = identity.remark?.trim() || identity.username || gitPlatformLabel(identity.platform);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderColor: t.line }, pressed && { opacity: 0.55 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} color={t.acTx} sw={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: t.tx, flexShrink: 1 }}>{title}</Text>
          <View style={{ paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 99, backgroundColor: t.bg4 }}>
            <Text style={{ fontSize: 10.5, fontWeight: '600', color: t.tx2 }}>{gitPlatformLabel(identity.platform)}</Text>
          </View>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 2, fontFamily: 'monospace' }}>{identity.base_url}</Text>
      </View>
      <IconButton icon="trash" iconSize={17} size={34} color={t.red} sw={1.8} onPress={onDelete} />
      <Icons.chevron size={16} color={t.tx3} sw={1.9} style={{ marginLeft: -6 }} />
    </Pressable>
  );
}

export default function GitIdentitiesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [identities, setIdentities] = useState<GitIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false); // 添加方式选择面板

  const load = useCallback(async () => {
    try {
      setIdentities(await listGitIdentities());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败，请重试');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onDelete = useCallback((identity: GitIdentity) => {
    const name = identity.remark?.trim() || identity.username || gitPlatformLabel(identity.platform);
    Alert.alert('移除账号', `确定要移除「${name}」吗？使用该账号的项目将无法继续拉取/提交代码。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGitIdentity(identity.id!);
            setIdentities((list) => list.filter((x) => x.id !== identity.id));
            setError('');
          } catch (e) {
            // 后端 409：被项目占用
            Alert.alert('无法移除', e instanceof ApiError ? e.message : '请稍后重试');
          }
        },
      },
    ]);
  }, []);

  // 添加方式：OAuth 平台一键授权 + 手动填 Token
  const addOptions: PickerOption[] = useMemo(() => [
    ...OAUTH_PLATFORMS.map((p) => ({ key: p.key, title: p.label, sub: '一键授权', icon: providerIcon(p.key) })),
    { key: MANUAL_KEY, title: '其他平台', sub: '手动填写 Access Token', icon: 'key' },
  ], []);

  const onPickAdd = useCallback((k: string) => {
    setAdding(false);
    if (k === MANUAL_KEY) router.push('/git-identity-form');
    else router.push({ pathname: '/git-oauth', params: { platform: k } });
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {loading ? (
        <LoadingView label="加载账号中…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 64, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.tx3} />}
        >
          {identities.length === 0 && error ? (
            <EmptyView icon="alert" title="加载失败" subtitle={`${error}\n下拉可重试`} />
          ) : identities.length === 0 ? (
            <EmptyView icon="key" title="还没有 Git 账号" subtitle={'绑定 GitHub / GitLab / Gitee 等账号后\n即可创建项目，让 AI 拉取与提交代码'} />
          ) : (
            <>
              {error ? <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12, marginBottom: 10 }}>刷新失败：{error}</Text> : null}
              <Card style={{ paddingHorizontal: 15, paddingVertical: 3 }}>
                {identities.map((it, i) => (
                  <IdentityRow key={it.id} identity={it} divider={i !== 0}
                    onPress={() => router.push({ pathname: '/git-identity-form', params: { id: it.id! } })}
                    onDelete={() => onDelete(it)} t={t} />
                ))}
              </Card>
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 14, paddingHorizontal: 4, lineHeight: 17 }}>
                点按账号可修改用户名 / 邮箱 / 备注与 Token。一个平台可绑定多个账号，创建项目时选择其一。
              </Text>
            </>
          )}
        </ScrollView>
      )}

      <GlassNav title="Git 账号" onBack={() => router.back()} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: t.bg }}>
        <PrimaryButton block label="添加 Git 账号" icon="plus" onPress={() => setAdding(true)} />
      </View>

      <PickerSheet visible={adding} title="添加 Git 账号" options={addOptions} onPick={onPickAdd} onClose={() => setAdding(false)} />
    </View>
  );
}
