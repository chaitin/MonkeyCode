import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useEffect, useRef, useState } from 'react';
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
const phoneValid = (v: string) => /^1[3-9]\d{9}$/.test(v.trim());

type LoginView = 'choices' | 'baizhi' | 'password';

export default function LoginScreen() {
  const t = useTheme();
  const {
    login,
    loginWithApple,
    sendBaizhiPhoneCode,
    loginWithBaizhiPhone,
    savedEmail,
    savedPassword,
    savedPhone,
    baseUrl,
    basicAuth,
    updateBaseUrl,
    updateBasicAuth,
  } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState(savedPassword);
  const [showPwd, setShowPwd] = useState(false);
  const [phone, setPhone] = useState(savedPhone);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(!!savedPassword);
  const [countdown, setCountdown] = useState(0);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(baseUrl);
  const [basicAuthInput, setBasicAuthInput] = useState(basicAuth);
  const [focused, setFocused] = useState<string | null>(null);
  const tapsRef = useRef(0);

  // 百智云登录入口只在官方云展示；私有化 / 自定义地址保持原账号密码入口。
  const cloud = norm(serverUrl || baseUrl) === DEFAULT_BASE_URL;
  const [view, setView] = useState<LoginView>(cloud && !savedPassword ? 'choices' : 'password');

  // Sign in with Apple（App Store Guideline 4.8：提供第三方登录时必须有等效的 Apple 登录）。
  // 仅 iOS 且系统支持时展示；官方云和自定义服务地址（如测试环境）都可用，
  // 后端未开启 Apple 登录时按返回的 404 给出明确提示。
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

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

  const focusProps = (name: string) => ({ onFocus: () => setFocused(name), onBlur: () => setFocused((f) => (f === name ? null : f)) });
  const fieldStyle = (name: string) => ({
    backgroundColor: t.bg3, borderWidth: 1, borderColor: focused === name ? t.ac : t.line2, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, color: t.tx, fontSize: 15,
  });

  const formatError = (e: unknown, fallback: string) => (
    e instanceof ApiError ? e.message : (e as Error)?.message || fallback
  );

  const applyServerSettings = async () => {
    const target = norm(serverUrl || baseUrl || DEFAULT_BASE_URL);
    if (target && target !== norm(baseUrl)) await updateBaseUrl(target);
    if (basicAuthInput.trim() !== basicAuth) await updateBasicAuth(basicAuthInput.trim());
    return target;
  };

  const onAppleLogin = async () => {
    setError('');
    if (!ensureAgreed()) return;
    setBusy(true);
    setPhase('正在登录…');
    try {
      await applyServerSettings();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('未获取到 Apple 登录凭证');
      // full_name 仅首次授权时下发，给后端建号用；邮箱后端只信 identity token 里的 claim，不另传
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
      await loginWithApple({
        identity_token: credential.identityToken,
        authorization_code: credential.authorizationCode ?? undefined,
        full_name: fullName || undefined,
      });
      // 导航交给根布局的鉴权守卫
    } catch (e) {
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return; // 用户取消，不算错误
      if (e instanceof ApiError && (e.status === 404 || e.code === 10002)) {
        setError('当前服务器未开启 Apple 登录');
        return;
      }
      setError(formatError(e, 'Apple 登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const onPasswordSubmit = async () => {
    setError('');
    if (!email.trim() || !password.trim()) { setError('请输入邮箱和密码'); return; }
    if (!ensureAgreed()) return;
    setBusy(true);
    setPhase('正在登录…');
    try {
      const targetBaseUrl = await applyServerSettings();
      await login(email, password, targetBaseUrl);
      setPhase('');
      // 导航交给根布局的鉴权守卫（会清栈进入主界面），避免登录页残留在返回栈里
    } catch (e) {
      setError(formatError(e, '登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const onSendCode = async () => {
    setError('');
    const cleanPhone = phone.trim();
    if (!phoneValid(cleanPhone)) { setError('请输入有效的手机号'); return; }
    if (!ensureAgreed()) return;
    setCodeBusy(true);
    try {
      await sendBaizhiPhoneCode(cleanPhone);
      setCountdown(60);
    } catch (e) {
      setError(formatError(e, '验证码发送失败，请稍后重试'));
    } finally {
      setCodeBusy(false);
    }
  };

  const onBaizhiSubmit = async () => {
    setError('');
    const cleanPhone = phone.trim();
    const cleanCode = code.trim();
    if (!phoneValid(cleanPhone)) { setError('请输入有效的手机号'); return; }
    if (!/^\d{4,6}$/.test(cleanCode)) { setError('请输入短信验证码'); return; }
    if (!ensureAgreed()) return;
    setBusy(true);
    setPhase('正在登录…');
    try {
      const targetBaseUrl = await applyServerSettings();
      await loginWithBaizhiPhone(cleanPhone, cleanCode, targetBaseUrl);
      setPhase('');
    } catch (e) {
      setError(formatError(e, '登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const openDoc = (path: string) => Linking.openURL(`${norm(baseUrl)}${path}`).catch(() => undefined);

  // Apple 登录按钮：登录方式选择页和账号密码页（自定义服务地址直接进入的视图）共用
  const AppleButton = appleAvailable ? (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={t.dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={16}
      style={{ height: 51, marginTop: 12, opacity: busy || codeBusy ? 0.6 : 1 }}
      onPress={() => { if (!busy && !codeBusy) void onAppleLogin(); }}
    />
  ) : null;

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
          <Text style={{ fontSize: 27, fontWeight: '800', color: t.tx, letterSpacing: 0 }}>MonkeyCode</Text>
          <Text style={{ fontSize: 13, color: t.tx3, marginTop: 3 }}>智能开发平台</Text>
        </View>

        <View style={[{ backgroundColor: t.bg2, borderRadius: 24, padding: 22 }, t.shCard]}>
          {view === 'choices' && cloud ? (
            <>
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.tx2 }}>选择登录方式</Text>
              <Pressable onPress={() => { setError(''); setView('baizhi'); }} disabled={busy || codeBusy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.ac, borderRadius: 16, paddingVertical: 15, marginTop: 18 }, t.shCard, { shadowColor: t.ac }, (busy || codeBusy || pressed) && { opacity: busy || codeBusy ? 0.6 : 0.8 }]}>
                <Image source={BAIZHI_ICON} style={{ width: 21, height: 21 }} resizeMode="contain" />
                <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>百智云登录</Text>
                <View style={{ backgroundColor: t.dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 1.5 }}>
                  <Text style={{ color: t.acInk, fontSize: 11, fontWeight: '700' }}>推荐</Text>
                </View>
              </Pressable>

              {AppleButton}

              <Pressable onPress={() => { setError(''); setView('password'); }} disabled={busy || codeBusy} style={({ pressed }) => [{ alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg3, borderWidth: 1, borderColor: t.line2, borderRadius: 16, paddingVertical: 15, marginTop: 12 }, (busy || codeBusy || pressed) && { opacity: busy || codeBusy ? 0.6 : 0.8 }]}>
                <Text style={{ color: t.tx, fontSize: 15, fontWeight: '600' }}>账号密码登录</Text>
              </Pressable>

              {busy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <ActivityIndicator color={t.tx2} size="small" />
                  <Text style={{ color: t.tx2, fontSize: 13 }}>{phase || '正在登录…'}</Text>
                </View>
              ) : null}
              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}
            </>
          ) : view === 'baizhi' && cloud ? (
            <>
              <Pressable onPress={() => { setError(''); setView('choices'); }} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16, alignSelf: 'flex-start' }}>
                <Icons.back size={16} color={t.tx2} sw={2} />
                <Text style={{ color: t.tx2, fontSize: 14 }}>其它登录方式</Text>
              </Pressable>

              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8 }}>手机号</Text>
              <TextInput
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 11))}
                placeholder="请输入手机号"
                placeholderTextColor={t.tx3}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                editable={!busy && !codeBusy}
                style={fieldStyle('phone')}
                {...focusProps('phone')}
              />

              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8, marginTop: 16 }}>验证码</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="短信验证码"
                  placeholderTextColor={t.tx3}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  editable={!busy}
                  style={[fieldStyle('code'), { flex: 1 }]}
                  onSubmitEditing={onBaizhiSubmit}
                  {...focusProps('code')}
                />
                <Pressable
                  onPress={onSendCode}
                  disabled={busy || codeBusy || countdown > 0}
                  style={({ pressed }) => [{ minWidth: 104, minHeight: Platform.OS === 'ios' ? 51 : 48, borderRadius: 14, borderWidth: 1, borderColor: t.line2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: t.bg3 }, pressed && { opacity: 0.82 }, (busy || codeBusy || countdown > 0) && { opacity: 0.55 }]}
                >
                  {codeBusy ? <ActivityIndicator color={t.ac} size="small" /> : <Text style={{ color: t.acTx, fontSize: 14, fontWeight: '700' }}>{countdown > 0 ? `${countdown}s` : '获取验证码'}</Text>}
                </Pressable>
              </View>

              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}

              <Pressable onPress={onBaizhiSubmit} disabled={busy || codeBusy} style={({ pressed }) => [{ backgroundColor: t.ac, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 16 }, t.shCard, { shadowColor: t.ac }, (busy || codeBusy || pressed) && { opacity: busy || codeBusy ? 0.75 : 0.86 }]}>
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color={t.acInk} size="small" />
                    <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>{phase || '登录中…'}</Text>
                  </View>
                ) : <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>登录</Text>}
              </Pressable>
            </>
          ) : (
            <>
              {cloud ? (
                <Pressable onPress={() => { setError(''); setView('choices'); }} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16, alignSelf: 'flex-start' }}>
                  <Icons.back size={16} color={t.tx2} sw={2} />
                  <Text style={{ color: t.tx2, fontSize: 14 }}>其它登录方式</Text>
                </Pressable>
              ) : null}

              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8 }}>邮箱</Text>
              <TextInput value={email} onChangeText={setEmail} placeholder="monkeycode@example.com" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy && !codeBusy} style={fieldStyle('email')} {...focusProps('email')} />

              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8, marginTop: 16 }}>密码</Text>
              <View style={[fieldStyle('pwd'), { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingRight: 6 }]}>
                <TextInput value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={t.tx3}
                  secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} editable={!busy && !codeBusy}
                  style={{ flex: 1, color: t.tx, fontSize: 15, paddingVertical: Platform.OS === 'ios' ? 14 : 10 }}
                  onSubmitEditing={onPasswordSubmit} {...focusProps('pwd')} />
                <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8} style={{ padding: 8 }}>
                  {showPwd ? <Icons.eyeOff size={20} color={t.tx2} sw={1.8} /> : <Icons.eye size={20} color={t.tx2} sw={1.8} />}
                </Pressable>
              </View>

              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}

              <Pressable onPress={onPasswordSubmit} disabled={busy || codeBusy} style={({ pressed }) => [{ backgroundColor: t.ac, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 16 }, t.shCard, { shadowColor: t.ac }, (busy || codeBusy || pressed) && { opacity: busy || codeBusy ? 0.75 : 0.86 }]}>
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color={t.acInk} size="small" />
                    <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>{phase || '登录中…'}</Text>
                  </View>
                ) : <Text style={{ color: t.acInk, fontSize: 16, fontWeight: '700' }}>登录</Text>}
              </Pressable>

              {/* 自定义服务地址（测试环境等）没有“选择登录方式”页，Apple 登录入口放在这里 */}
              {!cloud ? AppleButton : null}
            </>
          )}

          {/* 服务器设置：默认隐藏，连点 logo 6 次后出现 */}
          {showServer ? (
            <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: t.line }}>
              <Text style={{ fontSize: 13, color: t.tx2, marginBottom: 8 }}>服务器地址</Text>
              <TextInput value={serverUrl} onChangeText={setServerUrl} placeholder="https://monkeycode-ai.com" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy && !codeBusy} style={fieldStyle('server')} {...focusProps('server')} />
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 8 }}>私有化 / 离线部署可在此填写你的服务地址。</Text>

              <Text style={{ fontSize: 13, color: t.tx2, marginTop: 16, marginBottom: 8 }}>Basic Auth（可选）</Text>
              <TextInput value={basicAuthInput} onChangeText={setBasicAuthInput} placeholder="用户名:密码" placeholderTextColor={t.tx3}
                autoCapitalize="none" autoCorrect={false} editable={!busy && !codeBusy} style={fieldStyle('basic')} {...focusProps('basic')} />
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 8 }}>测试环境若有 HTTP Basic Auth 代理鉴权，在此填写「用户名:密码」，会作为 Authorization 头发送。</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
