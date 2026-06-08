import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, DEFAULT_BASE_URL } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const LOGO_LIGHT = require('../assets/logo-light.png');
const LOGO_DARK = require('../assets/logo-dark.png');
const BAIZHI_ICON = require('../assets/baizhi-dark.png'); // 白色猫头，配合绿色按钮上的白色文字
const norm = (u: string) => u.trim().replace(/\/+$/, '');

export default function LoginScreen() {
  const t = useTheme();
  const { login, savedEmail, savedPassword, baseUrl, basicAuth, updateBaseUrl, updateBasicAuth } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState(savedPassword);
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(!!savedPassword);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(baseUrl);
  const [basicAuthInput, setBasicAuthInput] = useState(basicAuth);
  const [focused, setFocused] = useState<string | null>(null);
  const tapsRef = useRef(0);

  // 百智云 OAuth 仅对官方云可用；私有化/自定义服务地址只走账号密码登录
  const cloud = norm(serverUrl || baseUrl) === DEFAULT_BASE_URL;
  const [view, setView] = useState<'choices' | 'password'>(cloud && !savedPassword ? 'choices' : 'password');

  const onLogoTap = () => {
    if (showServer) return;
    tapsRef.current += 1;
    if (tapsRef.current >= 6) setShowServer(true);
  };

  const ensureAgreed = () => {
    if (agreed) return true;
    setError('请先阅读并同意《用户协议》和《隐私政策》');
    return false;
  };

  const goOAuth = () => {
    setError('');
    if (!ensureAgreed()) return;
    router.push('/oauth');
  };

  const focusProps = (name: string) => ({ onFocus: () => setFocused(name), onBlur: () => setFocused((f) => (f === name ? null : f)) });
  const fieldStyle = (name: string) => ({
    backgroundColor: t.bg3, borderWidth: 1, borderColor: focused === name ? t.ac : t.line2, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, color: t.tx, fontSize: 15,
  });

  const onSubmit = async () => {
    setError('');
    if (!email.trim() || !password.trim()) { setError('请输入账号和密码'); return; }
    if (!ensureAgreed()) return;
    setBusy(true);
    try {
      if (serverUrl.trim() && norm(serverUrl) !== norm(baseUrl)) await updateBaseUrl(serverUrl.trim());
      if (basicAuthInput.trim() !== basicAuth) await updateBasicAuth(basicAuthInput.trim());
      setPhase('正在登录…');
      await login(email, password);
      setPhase('');
      // 导航交给根布局的鉴权守卫（会清栈进入主界面），避免登录页残留在返回栈里
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error)?.message || '登录失败，请重试');
    } finally { setBusy(false); setPhase(''); }
  };

  const openDoc = (path: string) => Linking.openURL(`${norm(baseUrl)}${path}`).catch(() => undefined);

  const Agreement = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16 }}>
      <Pressable onPress={() => setAgreed((v) => !v)} hitSlop={8} style={{ marginTop: 1, width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: agreed ? t.ac : t.line2, backgroundColor: agreed ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {agreed ? <Icons.check size={12} color={t.acInk} sw={3} /> : null}
      </Pressable>
      <Text style={{ flex: 1, fontSize: 12.5, color: t.tx3, lineHeight: 19 }}>
        我已阅读并同意
        <Text onPress={() => openDoc('/user-agreement')} style={{ color: t.acTx, fontWeight: '600' }}>《用户协议》</Text>
        和
        <Text onPress={() => openDoc('/privacy-policy')} style={{ color: t.acTx, fontWeight: '600' }}>《隐私政策》</Text>
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, paddingTop: insets.top + 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <Pressable onPress={onLogoTap} hitSlop={10}>
            <Image source={t.dark ? LOGO_DARK : LOGO_LIGHT} style={{ width: 104, height: 104, marginBottom: 10 }} resizeMode="contain" />
          </Pressable>
          <Text style={{ fontSize: 27, fontWeight: '800', color: t.tx, letterSpacing: -0.5 }}>MonkeyCode</Text>
          <Text style={{ fontSize: 13, color: t.tx3, marginTop: 3 }}>智能开发平台</Text>
        </View>

        <View style={[{ backgroundColor: t.bg2, borderRadius: 24, padding: 22 }, t.shCard]}>
          {view === 'choices' && cloud ? (
            <>
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.tx2 }}>选择登录方式</Text>
              <Pressable onPress={goOAuth} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.ac, borderRadius: 16, paddingVertical: 15, marginTop: 18 }, t.shCard, { shadowColor: t.ac }, pressed && { opacity: 0.8 }]}>
                <Image source={BAIZHI_ICON} style={{ width: 21, height: 21 }} resizeMode="contain" />
                <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>百智云登录</Text>
                <View style={{ backgroundColor: t.dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 1.5 }}>
                  <Text style={{ color: t.acInk, fontSize: 11, fontWeight: '700' }}>推荐</Text>
                </View>
              </Pressable>

              <Pressable onPress={() => { setError(''); setView('password'); }} style={({ pressed }) => [{ alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg3, borderWidth: 1, borderColor: t.line2, borderRadius: 16, paddingVertical: 15, marginTop: 12 }, pressed && { opacity: 0.8 }]}>
                <Text style={{ color: t.tx, fontSize: 15, fontWeight: '600' }}>账号密码登录</Text>
              </Pressable>

              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}

              {/* <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12.5, marginTop: 16 }}>
                还没有账号？
                <Text onPress={goOAuth} style={{ color: t.acTx, fontWeight: '600' }}>百智云快速注册</Text>
              </Text> */}
            </>
          ) : (
            <>
              {cloud ? (
                <Pressable onPress={() => { setError(''); setView('choices'); }} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16, alignSelf: 'flex-start' }}>
                  <Icons.back size={16} color={t.tx2} sw={2} />
                  <Text style={{ color: t.tx2, fontSize: 14 }}>其它登录方式</Text>
                </Pressable>
              ) : null}

              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8 }}>账号</Text>
              <TextInput value={email} onChangeText={setEmail} placeholder="monkeycode@example.com" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy} style={fieldStyle('email')} {...focusProps('email')} />

              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8, marginTop: 16 }}>密码</Text>
              <View style={[fieldStyle('pwd'), { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingRight: 6 }]}>
                <TextInput value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={t.tx3}
                  secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} editable={!busy}
                  style={{ flex: 1, color: t.tx, fontSize: 15, paddingVertical: Platform.OS === 'ios' ? 14 : 10 }}
                  onSubmitEditing={onSubmit} {...focusProps('pwd')} />
                <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8} style={{ padding: 8 }}>
                  {showPwd ? <Icons.eyeOff size={20} color={t.tx2} sw={1.8} /> : <Icons.eye size={20} color={t.tx2} sw={1.8} />}
                </Pressable>
              </View>

              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}

              <Pressable onPress={onSubmit} disabled={busy} style={({ pressed }) => [{ backgroundColor: t.ac, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 16 }, t.shCard, { shadowColor: t.ac }, (busy || pressed) && { opacity: 0.75 }]}>
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color={t.acInk} size="small" />
                    <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>{phase || '登录中…'}</Text>
                  </View>
                ) : <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>登录</Text>}
              </Pressable>
            </>
          )}

          {/* 服务器设置：默认隐藏，连点 logo 6 次后出现 */}
          {showServer ? (
            <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: t.line }}>
              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8 }}>服务器地址</Text>
              <TextInput value={serverUrl} onChangeText={setServerUrl} placeholder="https://monkeycode-ai.com" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} style={fieldStyle('server')} {...focusProps('server')} />
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 8 }}>私有化 / 离线部署可在此填写你的服务地址。</Text>

              <Text style={{ fontSize: 13, color: t.tx2, marginTop: 16, marginBottom: 8 }}>Basic Auth（可选）</Text>
              <TextInput value={basicAuthInput} onChangeText={setBasicAuthInput} placeholder="用户名:密码" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} editable={!busy} style={fieldStyle('basic')} {...focusProps('basic')} />
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 8 }}>测试环境若有 HTTP Basic Auth 代理鉴权，在此填写「用户名:密码」，会作为 Authorization 头发送。</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
