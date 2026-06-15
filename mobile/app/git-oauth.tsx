/**
 * Git 身份 OAuth 授权（WebView）。
 *
 * 复用登录页（app/oauth.tsx）的判定思路：WebView 先停在第三方平台授权/安装页（github.com /
 * gitee.com / gitlab.com …），用户授权后第三方回跳后端回调，后端凭会话 Cookie / state 把身份
 * 绑定到当前用户，再重定向回站点域名。一旦 WebView 从第三方域名回到后端域名（且加载完成），
 * 即视为完成 —— 返回上一页，身份管理列表在 focus 时自动刷新。
 *
 * - github：直接打开 GitHub App 安装地址（githubAppInstallUrl）。
 * - gitee / gitea / gitlab：先调用 authorize_url 拿到第三方授权地址再加载。
 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { authHeaders, basicAuthCredential as getBasicAuthCred, getBaseUrl, getGitOAuthUrl } from '@/api/client';
import { Icons } from '@/components/Icons';
import { Toast, TypingDots } from '@/components/ui';
import { GITLAB_DEFAULT_BASE, githubAppInstallUrl, gitPlatformLabel } from '@/git';
import { useTheme } from '@/theme';

const hostOf = (u: string) => u.match(/^https?:\/\/([^/]+)/)?.[1] ?? '';

// 标准浏览器 UA：避免第三方（Google 等）以「嵌入式 WebView 不安全」为由拦截登录（disallowed_useragent）。
// 关键差异——iOS 默认 WKWebView UA 缺 `Version/.. Safari`，Android 默认带 `; wv`，都会被识别为内嵌浏览器。
const BROWSER_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
  default: undefined,
}) as string | undefined;

export default function GitOAuthScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { platform } = useLocalSearchParams<{ platform?: string }>();

  const backendHost = useMemo(() => hostOf(getBaseUrl()), []);
  const label = gitPlatformLabel(platform);
  const isGithub = platform === 'github';

  // github 的安装地址同步可得，直接懒初始化；其余平台需异步拉取授权地址。
  const [webUrl, setWebUrl] = useState(() => (isGithub ? githubAppInstallUrl() : ''));
  const [preparing, setPreparing] = useState(!isGithub); // 拉取授权地址中
  const [finalizing, setFinalizing] = useState(false); // 已回到后端域名，正在收尾
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(''); // WebView 当前地址（供复制 / 外部浏览器打开）
  const [toast, setToast] = useState('');

  const leftRef = useRef(false); // 是否离开过后端域名（去过第三方授权页）
  const doneRef = useRef(false);

  // 拉取第三方 OAuth 授权地址（gitee/gitea/gitlab）。github 安装地址已同步初始化，跳过。
  // 用内联 async 取数，setState 均在异步回调里；reloadKey 变化（重试）会重新拉取。
  useEffect(() => {
    if (isGithub) return;
    let active = true;
    (async () => {
      try {
        const url = await getGitOAuthUrl(platform || '', platform === 'gitlab' ? GITLAB_DEFAULT_BASE : undefined);
        if (!active) return;
        if (!url) throw new Error('empty');
        setWebUrl(url);
      } catch {
        if (active) setError(`获取 ${label} 授权地址失败，请重试`);
      } finally {
        if (active) setPreparing(false);
      }
    })();
    return () => { active = false; };
  }, [isGithub, platform, label, reloadKey]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/git-identities'));

  const finalize = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFinalizing(true);
    // 给后端回调 → 站点重定向链留一点时间，再返回（列表在 focus 时刷新）
    setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/git-identities')), 700);
  }, [router]);

  const onNav = useCallback((navState: WebViewNavigation) => {
    // 始终记录当前主地址（即便已完成）：供「复制链接 / 用系统浏览器打开」用，
    // 解决第三方（如 Google）拦截嵌入式 WebView 登录的问题。
    if (navState.url && /^https?:/i.test(navState.url)) setCurrentUrl(navState.url);
    if (doneRef.current) return;
    const h = hostOf(navState.url);
    if (!h) return;
    if (h !== backendHost) {
      leftRef.current = true; // 进入第三方授权/安装页
      return;
    }
    // 必须真正去过第三方授权页后再回到后端域名才算完成（避免初始就在后端域名时误判）
    if (leftRef.current && !navState.loading) finalize();
  }, [backendHost, finalize]);

  // 重试由用户点击触发：重置判定标记并重载。非 github 时置回 preparing，
  // 由 reloadKey 变化驱动上面的 effect 重新拉取授权地址。
  const retry = useCallback(() => {
    doneRef.current = false;
    leftRef.current = false;
    setError('');
    setFinalizing(false);
    if (isGithub) setWebUrl(githubAppInstallUrl());
    else { setWebUrl(''); setPreparing(true); }
    setReloadKey((k) => k + 1);
  }, [isGithub]);

  // 复制当前地址（兜底：万一某第三方仍拦截，可复制链接自行处理）
  const shareUrl = currentUrl || webUrl;
  const showToast = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); }, []);
  const copyUrl = useCallback(() => {
    if (!shareUrl) return;
    void Clipboard.setStringAsync(shareUrl);
    showToast('链接已复制');
  }, [shareUrl, showToast]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
          <Pressable onPress={close} hitSlop={8} style={{ padding: 8 }}>
            <Icons.back size={22} color={t.tx} sw={2} />
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: t.tx, marginHorizontal: 2 }}>绑定 {label}</Text>
          <Pressable onPress={copyUrl} hitSlop={6} style={({ pressed }) => [{ padding: 7 }, pressed && { opacity: 0.5 }]}>
            <Icons.copy size={18} color={t.tx2} sw={1.9} />
          </Pressable>
          <Pressable onPress={retry} hitSlop={6} style={({ pressed }) => [{ padding: 7 }, pressed && { opacity: 0.5 }]}>
            <Icons.refresh size={19} color={t.tx2} sw={2} />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {preparing || (!webUrl && !error) ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }]}>
            <ActivityIndicator color={t.ac} />
            <Text style={{ color: t.tx2, fontSize: 13, marginTop: 12 }}>正在准备授权…</Text>
          </View>
        ) : error ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, paddingHorizontal: 40, gap: 14 }]}>
            <Icons.alert size={28} color={t.red} sw={2} />
            <Text style={{ color: t.tx, fontSize: 14, textAlign: 'center' }}>{error}</Text>
            <Pressable onPress={retry} style={{ backgroundColor: t.ac, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24 }}>
              <Text style={{ color: t.acInk, fontWeight: '700' }}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            key={reloadKey}
            source={{ uri: webUrl, headers: authHeaders() }}
            basicAuthCredential={getBasicAuthCred()}
            userAgent={BROWSER_UA}
            onNavigationStateChange={onNav}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            {...(Platform.OS === 'android' ? { cacheEnabled: true } : null)}
            startInLoadingState
            renderLoading={() => (
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }]}>
                <ActivityIndicator color={t.ac} />
              </View>
            )}
            style={{ flex: 1, backgroundColor: t.bg }}
          />
        )}

        {finalizing && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)' }]}>
            <View style={[{ backgroundColor: t.bg2, borderRadius: 18, paddingVertical: 22, paddingHorizontal: 26, alignItems: 'center', gap: 12, minWidth: 200 }, t.shCard]}>
              <ActivityIndicator color={t.ac} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ color: t.tx2, fontSize: 14 }}>正在完成绑定</Text>
                <TypingDots color={t.tx2} />
              </View>
            </View>
          </View>
        )}
      </View>

      {toast ? <Toast text={toast} bottom={insets.bottom + 30} /> : null}
    </View>
  );
}
