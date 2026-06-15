/**
 * 绑定 / 编辑 Git 账号 —— 对齐 Web add-identity.tsx 与 edit-identity.tsx。
 *  - 新增（无 id）：选平台 + 填 Access Token/用户名/邮箱/备注，自动带出默认 Base URL。
 *  - 编辑（带 ?id=）：回填该身份；platform / base_url 锁定不可改；用户名/邮箱/备注可改；
 *    Access Token 留空表示不修改。GitHub App 安装的身份（is_installation_app）隐藏 token 字段。
 * 保存成功后返回，身份列表在 focus 时刷新。
 */
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addGitIdentity, ApiError, listGitIdentities, updateGitIdentity } from '@/api/client';
import type { GitPlatform } from '@/api/types';
import { Icons, providerIcon } from '@/components/Icons';
import { GlassNav, LoadingView, PickerSheet, PrimaryButton, type PickerOption } from '@/components/ui';
import { GIT_PLATFORMS, gitPlatformDef, gitPlatformLabel } from '@/git';
import { spacing, useTheme } from '@/theme';

const TOKEN_DOC_URL = 'https://monkeycode.docs.baizhi.cloud/node/019a95ee-6277-7412-842a-587f25330ae6';

const isValidEmail = (email: string) => /^[a-zA-Z0-9+\-\_\.]+@[0-9a-zA-Z\.-]+$/.test(email);
// 禁止括号、引号等特殊字符（与 Web isValidUsername 一致），允许中文等 Unicode
const isValidUsername = (name: string) => !/[!@#$%\^\&\*\[\]\(\)\<\>'"]/.test(name);

export default function GitIdentityFormScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string; platform?: string }>();
  const editing = !!params.id;

  const [platform, setPlatform] = useState<GitPlatform | ''>((params.platform as GitPlatform) || '');
  const [baseUrl, setBaseUrl] = useState(gitPlatformDef(params.platform)?.defaultBaseUrl || '');
  const [accessToken, setAccessToken] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [remark, setRemark] = useState('');
  const [isInstallationApp, setIsInstallationApp] = useState(false); // GitHub App 安装：无需 token
  const [showToken, setShowToken] = useState(true);
  const [focused, setFocused] = useState<string | null>(null);
  const [platformPicking, setPlatformPicking] = useState(false);
  const [loading, setLoading] = useState(editing); // 编辑模式先拉取回填
  const [saving, setSaving] = useState(false);

  const leave = useCallback(() => {
    if (!navigation.isFocused()) return;
    if (router.canGoBack()) router.back();
    else router.replace('/git-identities');
  }, [navigation, router]);

  // 编辑模式：从列表取回该身份并回填（platform/base_url/username/email/remark；token 不回填，留空=不改）
  useEffect(() => {
    if (!editing) return;
    let active = true;
    listGitIdentities()
      .then((list) => {
        if (!active) return;
        const it = list.find((x) => x.id === params.id);
        if (!it) {
          Alert.alert('账号不存在', '该 Git 账号可能已被移除。');
          leave();
          return;
        }
        setPlatform(it.platform || '');
        setBaseUrl(it.base_url || '');
        setUsername(it.username || '');
        setEmail(it.email || '');
        setRemark(it.remark || '');
        setIsInstallationApp(it.is_installation_app === true);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        Alert.alert('加载失败', e instanceof ApiError ? e.message : '请稍后重试');
        leave();
      });
    return () => { active = false; };
  }, [editing, params.id, leave]);

  // 选平台（仅新增）：自动填默认地址（地址为空或仍是上一个平台默认值即用户没自定义时覆盖）
  const pickPlatform = useCallback((k: string) => {
    const def = gitPlatformDef(k);
    setPlatformPicking(false);
    if (!def) return;
    setBaseUrl((cur) => {
      const trimmed = cur.trim().replace(/\/+$/, '');
      const prevDefault = gitPlatformDef(platform)?.defaultBaseUrl;
      return trimmed === '' || trimmed === prevDefault ? def.defaultBaseUrl : cur;
    });
    setPlatform(def.key);
  }, [platform]);

  const focusProps = (name: string) => ({ onFocus: () => setFocused(name), onBlur: () => setFocused((f) => (f === name ? null : f)) });
  const fieldStyle = (name: string, disabled?: boolean) => ({
    backgroundColor: disabled ? t.bg4 : t.bg3, borderWidth: 1, borderColor: focused === name ? t.ac : t.line2, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 9, color: disabled ? t.tx3 : t.tx, fontSize: 15,
  });
  const label = (text: string, top = 16) => (
    <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600', marginTop: top, marginBottom: 8 }}>{text}</Text>
  );

  const platformOptions: PickerOption[] = useMemo(
    () => GIT_PLATFORMS.map((p) => ({ key: p.key, title: p.label, sub: p.defaultBaseUrl, icon: providerIcon(p.key) })),
    [],
  );

  // 编辑态隐藏 token 字段：仅 GitHub App 安装的身份（其余 PAT / OAuth 身份都可改 token）
  const showTokenField = !isInstallationApp;
  const tokenRequired = !editing; // 新增必填；编辑留空=不改

  const onSave = useCallback(async () => {
    if (saving) return;
    if (!platform) { Alert.alert('提示', '请选择 Git 平台类型'); return; }
    if (!baseUrl.trim()) { Alert.alert('提示', '请输入 Git 平台地址'); return; }
    if (tokenRequired && showTokenField && !accessToken.trim()) { Alert.alert('提示', '请输入 Access Token'); return; }
    if (!username.trim()) { Alert.alert('提示', '请输入用户名'); return; }
    if (!isValidUsername(username.trim())) { Alert.alert('提示', '用户名不能包含括号、引号等特殊字符'); return; }
    if (!email.trim()) { Alert.alert('提示', '请输入邮箱地址'); return; }
    if (!isValidEmail(email.trim())) { Alert.alert('提示', '请输入有效的邮箱地址'); return; }

    setSaving(true);
    try {
      if (editing) {
        // 只提交可改字段；token 留空表示不动（不传该字段）
        await updateGitIdentity(params.id!, {
          username: username.trim(),
          email: email.trim(),
          remark: remark.trim(),
          ...(showTokenField && accessToken.trim() ? { access_token: accessToken.trim() } : {}),
        });
      } else {
        await addGitIdentity({
          platform,
          base_url: baseUrl.trim(),
          access_token: accessToken.trim(),
          username: username.trim(),
          email: email.trim(),
          remark: remark.trim() || undefined,
        });
      }
      leave();
    } catch (e) {
      Alert.alert(editing ? '保存失败' : '绑定失败', e instanceof ApiError ? e.message : '请检查信息后重试');
    } finally {
      setSaving(false);
    }
  }, [saving, editing, params.id, platform, baseUrl, accessToken, username, email, remark, showTokenField, tokenRequired, leave]);

  const platformDef = gitPlatformDef(platform);
  const PlatIcon = Icons[providerIcon(platform || undefined)] ?? Icons.git;
  // 编辑态锁定平台与地址（对齐 Web edit-identity 的 disabled）
  const lockPlatform = editing;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <LoadingView label="加载账号…" />
        <GlassNav title="编辑 Git 账号" onBack={leave} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 110 }}
          keyboardShouldPersistTaps="handled"
        >
          {label('Git 平台类型', 0)}
          <Pressable onPress={() => setPlatformPicking(true)} disabled={saving || lockPlatform} style={({ pressed }) => [{
            flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: lockPlatform ? t.bg4 : t.bg3, borderWidth: 1, borderColor: t.line2,
            borderRadius: 14, paddingHorizontal: 14, height: 50,
          }, pressed && { opacity: 0.7 }]}>
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: lockPlatform ? t.bg3 : t.bg4, alignItems: 'center', justifyContent: 'center' }}>
              <PlatIcon size={17} color={platform ? t.acTx : t.tx3} sw={1.8} />
            </View>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: platform ? '600' : '400', color: platform ? (lockPlatform ? t.tx2 : t.tx) : t.tx3 }}>
              {platform ? gitPlatformLabel(platform) : '请选择平台'}
            </Text>
            {lockPlatform
              ? <Icons.shield size={15} color={t.tx3} sw={1.8} />
              : <Icons.chevron size={17} color={t.tx3} sw={1.9} style={{ transform: [{ rotate: '90deg' }] }} />}
          </Pressable>

          {label('Git 平台地址')}
          <TextInput value={baseUrl} onChangeText={setBaseUrl} placeholder={platformDef?.defaultBaseUrl || '例如：https://gitlab.com'}
            placeholderTextColor={t.tx3} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!saving && !lockPlatform}
            style={fieldStyle('baseUrl', lockPlatform)} {...focusProps('baseUrl')} />

          {showTokenField ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 }}>
                <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600' }}>Access Token{editing ? <Text style={{ color: t.tx3, fontWeight: '400' }}>（留空不修改）</Text> : null}</Text>
                <Pressable onPress={() => Linking.openURL(TOKEN_DOC_URL).catch(() => undefined)} hitSlop={6} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.6 }]}>
                  <Icons.alert size={13} color={t.tx2} sw={1.8} />
                  <Text style={{ fontSize: 12.5, color: t.tx2, fontWeight: '600' }}>如何获取</Text>
                </Pressable>
              </View>
              <View style={[fieldStyle('token'), { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingRight: 6 }]}>
                <TextInput value={accessToken} onChangeText={setAccessToken} placeholder={editing ? '留空表示不修改' : '请输入 Access Token'} placeholderTextColor={t.tx3}
                  secureTextEntry={!showToken} autoCapitalize="none" autoCorrect={false} editable={!saving}
                  style={{ flex: 1, color: t.tx, fontSize: 15, paddingVertical: Platform.OS === 'ios' ? 13 : 9 }} {...focusProps('token')} />
                <Pressable onPress={() => setShowToken((v) => !v)} hitSlop={8} style={{ padding: 8 }}>
                  {showToken ? <Icons.eyeOff size={19} color={t.tx2} sw={1.8} /> : <Icons.eye size={19} color={t.tx2} sw={1.8} />}
                </Pressable>
              </View>
            </>
          ) : null}

          {label('用户名')}
          <TextInput value={username} onChangeText={setUsername} placeholder="Git 平台用户名" placeholderTextColor={t.tx3}
            autoCapitalize="none" autoCorrect={false} editable={!saving} style={fieldStyle('username')} {...focusProps('username')} />

          {label('邮箱')}
          <TextInput value={email} onChangeText={setEmail} placeholder="提交代码用的邮箱地址" placeholderTextColor={t.tx3}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!saving}
            style={fieldStyle('email')} {...focusProps('email')} />

          {label('备注（选填）')}
          <TextInput value={remark} onChangeText={setRemark} placeholder="便于区分多个账号，如「我的 GitHub」" placeholderTextColor={t.tx3}
            editable={!saving} style={fieldStyle('remark')} {...focusProps('remark')} />

          <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 14, lineHeight: 17 }}>
            {isInstallationApp
              ? '该账号通过 GitHub App 安装，访问凭证由 App 自动管理，无需手动填写 Token。'
              : 'Token 用于在 Git 仓库中拉取与提交代码，请使用具备仓库读写权限的 Access Token。'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <GlassNav title={editing ? '编辑 Git 账号' : '绑定 Git 账号'} onBack={leave} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: t.bg }}>
        <PrimaryButton block label={saving ? '保存中…' : editing ? '保存修改' : '保存并绑定'} icon={saving ? undefined : 'check'} disabled={saving} onPress={onSave} />
      </View>

      <PickerSheet visible={platformPicking} title="选择 Git 平台" options={platformOptions} selected={platform || undefined}
        onPick={pickPlatform} onClose={() => setPlatformPicking(false)} />
    </View>
  );
}
