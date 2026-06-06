import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { authHeaders, basicAuthCredential as getBasicAuthCred } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { TypingDots } from '@/components/ui';
import { useTheme } from '@/theme';

const hostOf = (u: string) => u.match(/^https?:\/\/([^/]+)/)?.[1] ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 百智云 OAuth 登录。复用 Web 端入口：后端 /api/v1/users/login 会把浏览器重定向到百智云
 * 授权页，授权完成后回跳后端写入会话 Cookie，再跳到 /console/。
 *
 * 流程：WebView 先在后端域名，再跳到百智云域名（leftRef=true），授权后回到后端域名 →
 * 此时尝试用 getUserStatus 确认会话（WebView 与原生网络层共享 Cookie），成功即登录。
 */
export default function OAuthScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { baseUrl, completeOAuthLogin } = useAuth();

  const loginUrl = useMemo(() => `${baseUrl}/api/v1/users/login?redirect=&inviter_id=`, [baseUrl]);
  const backendHost = useMemo(() => hostOf(baseUrl), [baseUrl]);

  const leftRef = useRef(false); // 是否离开过后端域名（去过百智云）
  const doneRef = useRef(false); // 是否已完成，避免重复触发
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const finalize = useCallback(async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFinalizing(true);
    setError('');
    // Cookie 从 WebView 同步到原生网络层可能有轻微延迟，重试几次
    for (let i = 0; i < 4; i++) {
      try {
        await completeOAuthLogin();
        // 登录态切换后，根布局的鉴权守卫会清栈并进入主界面（清掉 OAuth + 登录屏）。
        return;
      } catch {
        await sleep(500);
      }
    }
    // 多次确认仍未登录：允许用户重试
    doneRef.current = false;
    setFinalizing(false);
    setError('未能确认登录状态，请重试');
  }, [completeOAuthLogin, router]);

  const onNav = useCallback(
    (navState: WebViewNavigation) => {
      if (doneRef.current) return;
      const h = hostOf(navState.url);
      if (!h) return;
      if (h !== backendHost) {
        leftRef.current = true; // 进入百智云授权页
        return;
      }
      // 必须真正经过百智云授权页（leftRef）后再回到后端域名才算登录成功。
      // 否则若本地还残留上一个账号的会话，后端会直接跳回 /console，会把上一个账号冒认成本次登录。
      if (leftRef.current && !navState.loading) {
        finalize();
      }
    },
    [backendHost, finalize],
  );

  const close = () => router.canGoBack() ? router.back() : router.replace('/login');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: t.bg2, borderBottomWidth: 1, borderColor: t.line }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
          <Pressable onPress={close} hitSlop={8} style={{ padding: 8 }}>
            <Icons.back size={22} color={t.tx} sw={2} />
          </Pressable>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icons.shield size={15} color={t.ac} sw={2} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: t.tx }}>百智云登录</Text>
          </View>
          <Pressable onPress={() => { doneRef.current = false; leftRef.current = false; setError(''); setReloadKey((k) => k + 1); }} hitSlop={8} style={{ padding: 8 }}>
            <Icons.refresh size={20} color={t.tx2} sw={2} />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <WebView
          key={reloadKey}
          source={{ uri: loginUrl, headers: authHeaders() }}
          basicAuthCredential={getBasicAuthCred()}
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

        {(finalizing || error) && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)' }]}>
            <View style={[{ backgroundColor: t.bg2, borderRadius: 18, paddingVertical: 22, paddingHorizontal: 26, alignItems: 'center', gap: 12, minWidth: 200 }, t.shCard]}>
              {error ? (
                <>
                  <Icons.alert size={26} color={t.red} sw={2} />
                  <Text style={{ color: t.tx, fontSize: 14, textAlign: 'center' }}>{error}</Text>
                  <Pressable onPress={() => { setError(''); leftRef.current = false; doneRef.current = false; setReloadKey((k) => k + 1); }} style={{ marginTop: 4, backgroundColor: t.ac, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 22 }}>
                    <Text style={{ color: t.acInk, fontWeight: '700' }}>重试</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <ActivityIndicator color={t.ac} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ color: t.tx2, fontSize: 14 }}>正在完成登录</Text>
                    <TypingDots color={t.tx2} />
                  </View>
                </>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
