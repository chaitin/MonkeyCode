import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { LoadingView } from '@/components/ui';
import { PreviewProvider } from '@/components/PreviewProvider';
import { ThemeProvider, useTheme } from '@/theme';
import { applyOta, useOtaAutoUpdate } from '@/updates/useOtaUpdate';

function RootNav() {
  const { ready, authenticated } = useAuth();
  const t = useTheme();
  const segments = useSegments();
  const router = useRouter();

  // 鉴权导航的唯一入口：未登录踢回登录页；登录成功后清掉登录屏并进入主界面。
  // 用 dismissAll 清栈，避免登录页残留在栈底导致「登录后返回又回到登录页」。
  useEffect(() => {
    if (!ready) return;
    const inAuthFlow = segments[0] === 'login';
    if (!authenticated) {
      if (!inAuthFlow) router.replace('/login');
    } else if (inAuthFlow) {
      if (router.canDismiss?.()) router.dismissAll();
      router.replace('/(tabs)/tasks');
    }
  }, [ready, authenticated, segments, router]);

  if (!ready) return <LoadingView label="正在加载…" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="task/[id]" />
      <Stack.Screen name="project/[id]" />
      <Stack.Screen name="new-task" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      {/* push 屏（非 modal）：因为它内部会进一步 push 出「管理账号 / 编辑账号」等用 GlassNav 的页面，
          若为 modal，iOS 上这些子页面会被压到状态栏下方，GlassNav 预留的 insets.top 就变成标题上方一大片空白。 */}
      <Stack.Screen name="new-project" />
      <Stack.Screen name="models" />
      {/* push 屏（非 modal）：用 GlassNav，modal 下 iOS 会顶部空白（同 git-identity-form） */}
      <Stack.Screen name="model-form" />
      <Stack.Screen name="git-identities" />
      {/* push 屏（非 modal）：从账号列表下钻编辑/新增，右滑进入；GlassNav 的 insets.top 在全屏 push 下才正确，
          若用 modal 则 iOS 上 insets.top 会与卡片偏移叠加，标题上方出现一大片空白。 */}
      <Stack.Screen name="git-identity-form" />
      <Stack.Screen name="git-oauth" />
    </Stack>
  );
}

function Themed() {
  const t = useTheme();
  // OTA：启动/回前台静默检查下载，下载好后提示一次重启生效（不打断当前操作）。
  useOtaAutoUpdate(useCallback(() => {
    Alert.alert('发现新版本', '已下载更新，重启应用即可生效。', [
      { text: '稍后' },
      { text: '立即重启', onPress: () => { void applyOta(); } },
    ]);
  }, []));
  // SDK 56：expo-router 不再基于 react-navigation，导航主题改由各屏 Stack 的 contentStyle 决定。
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <PreviewProvider>
        <RootNav />
      </PreviewProvider>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ThemeProvider>
          <AuthProvider>
            <Themed />
          </AuthProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
