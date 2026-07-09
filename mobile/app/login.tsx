import * as AppleAuthentication from 'expo-apple-authentication';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { BAIZHI_BASE_URL, getBaizhiOAuthLoginUrl, getMonkeyCodeBaizhiLoginUrl } from '@/api/baizhi';
import { ApiError, authHeaders, basicAuthCredential as getBasicAuthCred, DEFAULT_BASE_URL } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { authorizeDouyin } from '@/native/douyinAuth';
import { useTheme } from '@/theme';

const LOGO_LIGHT = require('../assets/logo-light.png');
const norm = (u: string) => u.trim().replace(/\/+$/, '');
const phoneValid = (v: string) => /^1[3-9]\d{9}$/.test(v.trim());
const GITHUB_CALLBACK_URL = 'monkeycode://oauth/github';
const BAIZHI_HOST = 'baizhi.cloud';
const BROWSER_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
  default: undefined,
}) as string | undefined;

type LoginView = 'password' | 'phone' | 'oauthWeb';
type WebOAuthMode = 'github' | 'baizhiBridge';
type BaizhiBridgeState = { targetBaseUrl: string; phoneToSave?: string; authorizeViaFetch?: boolean };

function hostOf(url: string): string {
  return url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase() || '';
}

function pathOf(url: string): string {
  return url.match(/^https?:\/\/[^/]+([^?#]*)/i)?.[1] || '';
}

function parseUrlQuery(url: string): Record<string, string> {
  const start = url.indexOf('?');
  if (start < 0) return {};
  const hash = url.indexOf('#', start + 1);
  const raw = url.slice(start + 1, hash < 0 ? undefined : hash);
  const params: Record<string, string> = {};
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    try {
      params[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      params[key] = value;
    }
  }
  return params;
}

function buildUrlQuery(query: Record<string, string | undefined>): string {
  return Object.entries(query)
    .filter(([, value]) => value)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value || '')}`)
    .join('&');
}

function toBaizhiAuthorizeApiUrl(url: string): string {
  if (hostOf(url) !== BAIZHI_HOST || pathOf(url) !== '/oauth/authorize') return '';
  const params = parseUrlQuery(url);
  const clientID = params.client_id;
  const redirectUri = params.redirect_uri || params.redirect_url;
  const scope = params.scope;
  const state = params.state;
  const responseType = params.response_type || 'code';
  if (!clientID || !redirectUri || !scope || !state) return '';
  return `${BAIZHI_BASE_URL}/api/v1/oauth/authorize?${buildUrlQuery({
    client_id: clientID,
    redirect_uri: redirectUri,
    scope,
    state,
    response_type: responseType,
  })}`;
}

function isGithubCallback(url: string): boolean {
  return url.startsWith(GITHUB_CALLBACK_URL) || url.startsWith('monkeycode:///oauth/github');
}

async function readResponseError(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.clone().json()) as { message?: string };
    if (json?.message) return json.message.replace(/\s*\[trace_id:[^\]]+\]\s*$/i, '').trim();
  } catch {
    try {
      const text = await res.text();
      if (text.trim()) return text.trim();
    } catch {
      /* keep fallback */
    }
  }
  return fallback;
}

export default function LoginScreen() {
  const t = useTheme();
  const {
    login,
    loginWithApple,
    sendBaizhiPhoneCode,
    startBaizhiPhoneLogin,
    startDouyinAppBaizhiLogin,
    finishBaizhiOAuthLogin,
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
  const [webOAuthUrl, setWebOAuthUrl] = useState('');
  const [webOAuthTitle, setWebOAuthTitle] = useState('');
  const [webOAuthMode, setWebOAuthMode] = useState<WebOAuthMode>('github');
  const [webOAuthKey, setWebOAuthKey] = useState(0);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(baseUrl);
  const [basicAuthInput, setBasicAuthInput] = useState(basicAuth);
  const [focused, setFocused] = useState<string | null>(null);
  const tapsRef = useRef(0);
  const phoneInputRef = useRef<TextInput>(null);
  const handledGithubCallbackRef = useRef(false);
  const baizhiBridgeLeftRef = useRef(false);
  const baizhiBridgeDoneRef = useRef(false);
  const baizhiAutoAuthorizeUrlRef = useRef('');
  const baizhiBridgeRef = useRef<BaizhiBridgeState | null>(null);

  // 手机号 / 抖音 / GitHub 登录入口只在官方云展示；私有化 / 自定义地址保持账号密码入口。
  const cloud = norm(serverUrl || baseUrl) === DEFAULT_BASE_URL;
  const [view, setView] = useState<LoginView>('password');

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
  const pageBg = '#F6F7F3';
  const heroGreen = '#1FA855';
  const heroGreen2 = '#1A9C50';
  const sheetBg = '#FFFFFF';
  const fieldBg = '#F4F5F1';
  const fieldBorder = '#E7E8E2';
  const inputText = '#262A27';
  const darkText = '#17181A';
  const iconIdle = '#A9AFA6';
  const mutedText = '#8A9089';
  const softText = '#A2A89F';
  const loginShadow = { shadowColor: '#143C23', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.28, shadowRadius: 25, elevation: 4 };
  const primaryShadow = { shadowColor: heroGreen2, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.35, shadowRadius: 13, elevation: 3 };
  const fieldFrameStyle = (name: string) => ({
    height: 54,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    paddingHorizontal: 16,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: focused === name ? heroGreen : fieldBorder,
    backgroundColor: focused === name ? sheetBg : fieldBg,
    shadowColor: heroGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: focused === name ? 0.13 : 0,
    shadowRadius: 10,
    elevation: focused === name ? 1 : 0,
  });
  const inputStyle = { flex: 1, minWidth: 0, color: inputText, fontSize: 15.5, fontWeight: '600' as const, paddingVertical: 0 };
  const loginDisabled = busy || codeBusy || !agreed;
  const actionBusy = busy || codeBusy;

  const formatError = (e: unknown, fallback: string) => (
    e instanceof ApiError ? e.message : (e as Error)?.message || fallback
  );

  const applyServerSettings = useCallback(async () => {
    const target = norm(serverUrl || baseUrl || DEFAULT_BASE_URL);
    if (target && target !== norm(baseUrl)) await updateBaseUrl(target);
    if (basicAuthInput.trim() !== basicAuth) await updateBasicAuth(basicAuthInput.trim());
    return target;
  }, [baseUrl, basicAuth, basicAuthInput, serverUrl, updateBaseUrl, updateBasicAuth]);

  const startBaizhiBridge = useCallback((title: string, targetBaseUrl: string, phoneToSave?: string, authorizeViaFetch = false) => {
    const cleanTarget = norm(targetBaseUrl || baseUrl || DEFAULT_BASE_URL);
    baizhiBridgeRef.current = { targetBaseUrl: cleanTarget, phoneToSave, authorizeViaFetch };
    baizhiBridgeLeftRef.current = false;
    baizhiBridgeDoneRef.current = false;
    baizhiAutoAuthorizeUrlRef.current = '';
    setWebOAuthMode('baizhiBridge');
    setWebOAuthTitle(title);
    setWebOAuthUrl(getMonkeyCodeBaizhiLoginUrl(cleanTarget));
    setWebOAuthKey((k) => k + 1);
    setView('oauthWeb');
  }, [baseUrl]);

  const finishBaizhiBridgeLogin = useCallback(async () => {
    if (baizhiBridgeDoneRef.current) return;
    const bridge = baizhiBridgeRef.current;
    if (!bridge) return;
    baizhiBridgeDoneRef.current = true;
    setError('');
    setBusy(true);
    setPhase('正在完成登录…');
    try {
      await finishBaizhiOAuthLogin(bridge.targetBaseUrl, bridge.phoneToSave);
    } catch (e) {
      baizhiBridgeDoneRef.current = false;
      baizhiBridgeLeftRef.current = false;
      baizhiAutoAuthorizeUrlRef.current = '';
      baizhiBridgeRef.current = null;
      setWebOAuthUrl('');
      setWebOAuthTitle('');
      setWebOAuthMode('github');
      setView(bridge.phoneToSave ? 'phone' : 'password');
      setError(formatError(e, '登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  }, [finishBaizhiOAuthLogin]);

  const finishGithubOAuthLogin = useCallback(async () => {
    if (handledGithubCallbackRef.current) return;
    handledGithubCallbackRef.current = true;
    setError('');
    setBusy(true);
    setPhase('正在完成 GitHub 登录…');
    try {
      const targetBaseUrl = await applyServerSettings();
      startBaizhiBridge('GitHub 登录', targetBaseUrl);
    } catch (e) {
      handledGithubCallbackRef.current = false;
      setView('password');
      setError(formatError(e, 'GitHub 登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  }, [applyServerSettings, startBaizhiBridge]);

  const handleOAuthCallback = useCallback(
    async (url: string) => {
      if (isGithubCallback(url)) {
        await finishGithubOAuthLogin();
      }
    },
    [finishGithubOAuthLogin],
  );

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => { void handleOAuthCallback(url); });
    Linking.getInitialURL().then((url) => { if (url) void handleOAuthCallback(url); }).catch(() => undefined);
    return () => sub.remove();
  }, [handleOAuthCallback]);

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

  const onDouyinLogin = async () => {
    setError('');
    if (!ensureAgreed()) return;
    setBusy(true);
    setPhase('正在打开抖音…');
    try {
      const targetBaseUrl = await applyServerSettings();
      const result = await authorizeDouyin();
      setPhase('正在完成抖音登录…');
      await startDouyinAppBaizhiLogin(result.code);
      startBaizhiBridge('抖音登录', targetBaseUrl, undefined, true);
    } catch (e) {
      if ((e as { code?: string })?.code === 'E_DOUYIN_CANCELLED') return;
      setError(formatError(e, '抖音登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const onGithubLogin = async () => {
    setError('');
    if (!ensureAgreed()) return;
    setBusy(true);
    setPhase('正在打开 GitHub…');
    try {
      await applyServerSettings();
      const authorizeUrl = await getBaizhiOAuthLoginUrl('github', GITHUB_CALLBACK_URL);
      handledGithubCallbackRef.current = false;
      setWebOAuthMode('github');
      setWebOAuthTitle('GitHub 登录');
      setWebOAuthUrl(authorizeUrl);
      setWebOAuthKey((k) => k + 1);
      setView('oauthWeb');
    } catch (e) {
      setError(formatError(e, '打开 GitHub 登录失败，请重试'));
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
      await startBaizhiPhoneLogin(cleanPhone, cleanCode);
      startBaizhiBridge('手机号登录', targetBaseUrl, cleanPhone, true);
    } catch (e) {
      setError(formatError(e, '登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const closeWebOAuth = () => {
    const nextView = webOAuthMode === 'baizhiBridge' && baizhiBridgeRef.current?.phoneToSave ? 'phone' : 'password';
    baizhiBridgeRef.current = null;
    baizhiBridgeLeftRef.current = false;
    baizhiBridgeDoneRef.current = false;
    baizhiAutoAuthorizeUrlRef.current = '';
    setWebOAuthUrl('');
    setWebOAuthTitle('');
    setWebOAuthMode('github');
    setView(nextView);
  };

  const authorizeBaizhiWithNativeSession = useCallback(async (apiUrl: string) => {
    const bridge = baizhiBridgeRef.current;
    if (!bridge || baizhiBridgeDoneRef.current) return;
    setError('');
    setBusy(true);
    setPhase('正在确认授权…');
    try {
      const res = await fetch(apiUrl, { credentials: 'include', redirect: 'follow' });
      if (!res.ok) {
        throw new ApiError(await readResponseError(res, `百智云授权失败（${res.status}）`), undefined, res.status);
      }
      await finishBaizhiBridgeLogin();
    } catch (e) {
      baizhiBridgeDoneRef.current = false;
      baizhiBridgeLeftRef.current = false;
      baizhiAutoAuthorizeUrlRef.current = '';
      baizhiBridgeRef.current = null;
      setWebOAuthUrl('');
      setWebOAuthTitle('');
      setWebOAuthMode('github');
      setView(bridge.phoneToSave ? 'phone' : 'password');
      setError(formatError(e, '登录失败，请重试'));
    } finally {
      setBusy(false);
      setPhase('');
    }
  }, [finishBaizhiBridgeLogin]);

  const openBaizhiAuthorizeApi = useCallback((url: string) => {
    if (webOAuthMode !== 'baizhiBridge') return false;
    const apiUrl = toBaizhiAuthorizeApiUrl(url);
    if (!apiUrl) return false;
    if (baizhiAutoAuthorizeUrlRef.current === apiUrl) return true;
    baizhiAutoAuthorizeUrlRef.current = apiUrl;
    if (baizhiBridgeRef.current?.authorizeViaFetch) {
      void authorizeBaizhiWithNativeSession(apiUrl);
    } else {
      setPhase('正在确认授权…');
      setWebOAuthUrl(apiUrl);
      setWebOAuthKey((k) => k + 1);
    }
    return true;
  }, [authorizeBaizhiWithNativeSession, webOAuthMode]);

  const onWebOAuthNav = useCallback(
    (navState: WebViewNavigation) => {
      if (webOAuthMode === 'github') {
        if (isGithubCallback(navState.url)) void finishGithubOAuthLogin();
        return;
      }
      if (openBaizhiAuthorizeApi(navState.url)) return;
      const bridge = baizhiBridgeRef.current;
      const backendHost = hostOf(bridge?.targetBaseUrl || baseUrl);
      const currentHost = hostOf(navState.url);
      if (!backendHost || !currentHost || baizhiBridgeDoneRef.current) return;
      if (currentHost !== backendHost) {
        baizhiBridgeLeftRef.current = true;
        return;
      }
      if (!navState.loading && (baizhiBridgeLeftRef.current || pathOf(navState.url) !== '/api/v1/users/login')) {
        void finishBaizhiBridgeLogin();
      }
    },
    [baseUrl, openBaizhiAuthorizeApi, finishBaizhiBridgeLogin, finishGithubOAuthLogin, webOAuthMode],
  );

  const onWebOAuthShouldStart = useCallback(
    (req: { url: string }) => {
      if (webOAuthMode === 'github' && isGithubCallback(req.url)) {
        void finishGithubOAuthLogin();
        return false;
      }
      if (openBaizhiAuthorizeApi(req.url)) return false;
      return true;
    },
    [openBaizhiAuthorizeApi, finishGithubOAuthLogin, webOAuthMode],
  );

  const openDoc = (path: string) => Linking.openURL(`${norm(baseUrl)}${path}`).catch(() => undefined);

  const HeroBackground = (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 336, borderBottomLeftRadius: 44, borderBottomRightRadius: 44, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox="0 0 390 336" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2ED06B" />
            <Stop offset="1" stopColor="#12904A" />
          </SvgLinearGradient>
        </Defs>
        <Rect x={0} y={0} width={390} height={336} fill="url(#heroGrad)" />
        <Circle cx={320} cy={50} r={120} fill="rgba(255,255,255,0.13)" />
        <Circle cx={50} cy={366} r={90} fill="rgba(255,255,255,0.09)" />
        <Circle cx={285} cy={165} r={45} fill="rgba(255,255,255,0.06)" />
      </Svg>
    </View>
  );

  const LoginButtonBackground = (
    <Svg pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} width="100%" height="100%" viewBox="0 0 320 54" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id="loginGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#27B866" />
          <Stop offset="1" stopColor="#1A9C50" />
        </SvgLinearGradient>
      </Defs>
      <Rect x={0} y={0} width={320} height={54} rx={15} fill="url(#loginGrad)" />
    </Svg>
  );

  const SocialLoginButtons = view === 'password' && (appleAvailable || cloud) ? (
    <>
      <View style={{ marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: '#E1E0DA' }} />
        <Text style={{ color: softText, fontSize: 12, fontWeight: '600' }}>其它登录方式</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: '#E1E0DA' }} />
      </View>

      <View style={{ marginTop: 18, flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
        {appleAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in with Apple"
            onPress={() => { if (!busy && !codeBusy) void onAppleLogin(); }}
            disabled={actionBusy}
            style={({ pressed }) => [
              { width: 50, height: 50, borderRadius: 25, backgroundColor: '#16171A', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.24, shadowRadius: 9, elevation: 3 },
              pressed && { opacity: 0.86 },
              actionBusy && { opacity: 0.55 },
            ]}
          >
            <Icons.apple size={22} color="#FFFFFF" />
          </Pressable>
        ) : null}

        {cloud ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="手机号登录" onPress={() => { setError(''); setView('phone'); }} disabled={actionBusy} style={({ pressed }) => [{ width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: '#E7E6E0', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.78 }, actionBusy && { opacity: 0.55 }]}>
              <Icons.phoneDevice size={22} color="#20231F" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="抖音登录" onPress={onDouyinLogin} disabled={actionBusy} style={({ pressed }) => [{ width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: '#E7E6E0', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.78 }, actionBusy && { opacity: 0.55 }]}>
              <Icons.douyinBrand size={24} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="GitHub 登录" onPress={onGithubLogin} disabled={actionBusy} style={({ pressed }) => [{ width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: '#E7E6E0', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.78 }, actionBusy && { opacity: 0.55 }]}>
              <Icons.github size={22} color="#16171A" />
            </Pressable>
          </>
        ) : null}
      </View>
    </>
  ) : null;

  const Agreement = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 2 }}>
      <Pressable onPress={() => setAgreed((v) => !v)} hitSlop={8} style={{ marginTop: 1, width: 19, height: 19, borderRadius: 6, borderWidth: 2, borderColor: agreed ? heroGreen : '#CDD1C9', backgroundColor: agreed ? heroGreen : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {agreed ? <Icons.check size={12} color="#FFFFFF" sw={3} /> : null}
      </Pressable>
      <Text style={{ flex: 1, fontSize: 12.5, color: mutedText, lineHeight: 19, fontWeight: '600' }}>
        我已阅读并同意
        <Text onPress={() => openDoc('/user-agreement')} style={{ color: heroGreen, fontWeight: '700' }}>《用户协议》</Text>
        和
        <Text onPress={() => openDoc('/privacy-policy')} style={{ color: heroGreen, fontWeight: '700' }}>《隐私政策》</Text>
      </Text>
    </View>
  );

  const webOAuthNeedsMonkeyCodeAuth = webOAuthMode === 'baizhiBridge' && hostOf(webOAuthUrl) !== BAIZHI_HOST;
  const webOAuthCanUseMonkeyCodeAuth = webOAuthMode === 'baizhiBridge';
  const webOAuthSource = webOAuthNeedsMonkeyCodeAuth
    ? { uri: webOAuthUrl, headers: authHeaders() }
    : { uri: webOAuthUrl };

  if (view === 'oauthWeb' && webOAuthUrl) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ paddingTop: insets.top, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
          <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
            <Pressable onPress={closeWebOAuth} hitSlop={8} style={{ padding: 8 }}>
              <Icons.back size={22} color={t.tx} sw={2} />
            </Pressable>
            <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: t.tx, marginHorizontal: 2 }}>{webOAuthTitle || '授权登录'}</Text>
            <View style={{ width: 38 }} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <WebView
            key={webOAuthKey}
            source={webOAuthSource}
            originWhitelist={['https://*', 'http://*', 'monkeycode://*']}
            basicAuthCredential={webOAuthCanUseMonkeyCodeAuth ? getBasicAuthCred() : undefined}
            userAgent={BROWSER_UA}
            onNavigationStateChange={onWebOAuthNav}
            onShouldStartLoadWithRequest={onWebOAuthShouldStart}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
                <ActivityIndicator color={t.ac} />
              </View>
            )}
            style={{ flex: 1, backgroundColor: t.bg }}
          />
          {busy ? (
            <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.82)' }}>
              <View style={[{ backgroundColor: t.bg2, borderRadius: 18, paddingVertical: 22, paddingHorizontal: 26, alignItems: 'center', gap: 12, minWidth: 200 }, t.shCard]}>
                <ActivityIndicator color={t.ac} />
                <Text style={{ color: t.tx2, fontSize: 14 }}>{phase || '正在完成登录…'}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: pageBg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      {HeroBackground}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingBottom: 34, paddingTop: insets.top + 36 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={onLogoTap} hitSlop={10} style={[{ width: 60, height: 60, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, { shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4 }]}>
            <Image source={LOGO_LIGHT} style={{ width: 42, height: 42 }} resizeMode="contain" />
          </Pressable>
          <View>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0 }}>MonkeyCode</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.82)', marginTop: 2, letterSpacing: 1 }}>智能开发平台</Text>
          </View>
        </View>

        <Text style={{ marginTop: 32, fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0 }}>欢迎回来 👋</Text>
        <Text style={{ marginTop: 8, fontSize: 14.5, fontWeight: '500', color: 'rgba(255,255,255,0.85)' }}>登录以继续你的智能开发之旅</Text>

        <View style={[{ marginTop: 30, backgroundColor: sheetBg, borderRadius: 26, paddingTop: 22, paddingHorizontal: 22, paddingBottom: 24, gap: 15 }, loginShadow]}>
          {view === 'phone' && cloud ? (
            <>
              <Pressable onPress={() => { setError(''); setView('password'); }} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
                <Icons.back size={16} color={mutedText} sw={2} />
                <Text style={{ color: mutedText, fontSize: 14 }}>账号密码登录</Text>
              </Pressable>

              <Pressable
                onPress={() => phoneInputRef.current?.focus()}
                style={({ pressed }) => [fieldFrameStyle('phone'), focused === 'phone' && { borderWidth: 2, shadowOpacity: 0.18, shadowRadius: 12 }, pressed && { opacity: 0.96 }]}
              >
                <Icons.phoneDevice size={19} color={focused === 'phone' ? heroGreen : iconIdle} />
                <TextInput
                  ref={phoneInputRef}
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 11))}
                  placeholder="请输入手机号"
                  placeholderTextColor="#B4B9B0"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  editable={!busy && !codeBusy}
                  style={inputStyle}
                  {...focusProps('phone')}
                />
              </Pressable>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={[fieldFrameStyle('code'), { flex: 1 }]}>
                  <Icons.key size={19} color={focused === 'code' ? heroGreen : iconIdle} sw={1.9} />
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="短信验证码"
                    placeholderTextColor="#B4B9B0"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    editable={!busy}
                    style={inputStyle}
                    onSubmitEditing={onBaizhiSubmit}
                    {...focusProps('code')}
                  />
                </View>
                <Pressable
                  onPress={onSendCode}
                  disabled={busy || codeBusy || countdown > 0}
                  style={({ pressed }) => [{ width: 104, height: 54, borderRadius: 15, borderWidth: 1.5, borderColor: fieldBorder, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: fieldBg }, pressed && { opacity: 0.82 }, (busy || codeBusy || countdown > 0) && { opacity: 0.55 }]}
                >
                  {codeBusy ? <ActivityIndicator color={heroGreen} size="small" /> : <Text style={{ color: heroGreen, fontSize: 14, fontWeight: '800' }}>{countdown > 0 ? `${countdown}s` : '获取验证码'}</Text>}
                </Pressable>
              </View>

              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}

              <Pressable onPress={onBaizhiSubmit} disabled={loginDisabled} style={({ pressed }) => [{ height: 54, backgroundColor: heroGreen2, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 4, overflow: 'hidden' }, primaryShadow, (loginDisabled || pressed) && { opacity: loginDisabled ? 0.55 : 0.86 }]}>
                {LoginButtonBackground}
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>{phase || '登录中…'}</Text>
                  </View>
                ) : <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 2 }}>登 录</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 18, fontWeight: '600', color: darkText, letterSpacing: 0 }}>账号密码登录</Text>

              <View style={fieldFrameStyle('email')}>
                <Icons.mail size={19} color={focused === 'email' ? heroGreen : iconIdle} sw={1.9} />
                <TextInput value={email} onChangeText={setEmail} placeholder="dev@monkeycode.io" placeholderTextColor="#B4B9B0"
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy && !codeBusy}
                  style={inputStyle} {...focusProps('email')} />
              </View>

              <View style={[fieldFrameStyle('pwd'), { paddingRight: 8 }]}>
                <Icons.lock size={19} color={focused === 'pwd' ? heroGreen : iconIdle} sw={1.9} />
                <TextInput value={password} onChangeText={setPassword} placeholder="请输入密码" placeholderTextColor="#B4B9B0"
                  secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} editable={!busy && !codeBusy}
                  style={inputStyle}
                  onSubmitEditing={onPasswordSubmit} {...focusProps('pwd')} />
                <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8} style={{ padding: 8 }}>
                  {showPwd ? <Icons.eye size={20} color={iconIdle} sw={1.8} /> : <Icons.eyeOff size={20} color={iconIdle} sw={1.8} />}
                </Pressable>
              </View>

              {error ? <Text style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
              {Agreement}

              <Pressable onPress={onPasswordSubmit} disabled={loginDisabled} style={({ pressed }) => [{ height: 54, backgroundColor: heroGreen2, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 4, overflow: 'hidden' }, primaryShadow, (loginDisabled || pressed) && { opacity: loginDisabled ? 0.55 : 0.86 }]}>
                {LoginButtonBackground}
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>{phase || '登录中…'}</Text>
                  </View>
                ) : <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 2 }}>登 录</Text>}
              </Pressable>

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

        {SocialLoginButtons}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
