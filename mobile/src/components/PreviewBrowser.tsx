/**
 * 应用内浏览器（在线预览）。用 react-native-webview 在 App 内打开开发环境的预览地址。
 * 关闭分两种：
 *   - 收起（minimize）：面板滑到屏幕外但 WebView 保持挂载，再次展开秒回、无需重载；
 *     收起后由 composer 上方的「在线预览」条充当最小化入口，点它即可重新展开。
 *   - 真正关闭（onClose）：卸载 WebView。
 * 预览地址是独立公网 URL，不携带 MonkeyCode 的会话 Cookie / Basic Auth（避免 cookie 泄漏到预览域名）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const hostOf = (url: string) => url.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0] || url;

export function PreviewBrowser({ url, minimized, onMinimize, onClose }: {
  url: string | null;
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const { top } = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const ref = useRef<WebView>(null);
  const ty = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [layoutH, setLayoutH] = useState(0);
  // 收起时下移的距离：用浮层自身的真实高度（onLayout）。Android 边到边下 useWindowDimensions 的高度
  // 比浮层实际高度小，按它下移会留一条没收干净、盖住输入框；用实测高度可彻底收起。
  const offY = layoutH || winH;

  const open = !!url;
  // 收起 = 整体滑出屏幕底部（保持挂载）；展开 = 滑回。
  useEffect(() => {
    Animated.timing(ty, { toValue: minimized ? offY : 0, duration: 240, useNativeDriver: true }).start();
  }, [minimized, offY, ty]);

  // Android 实体返回键：浏览器展开时优先回退网页历史，否则收起（而不是退出任务页）。
  useEffect(() => {
    if (!open || minimized) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { ref.current?.goBack(); return true; }
      onMinimize();
      return true;
    });
    return () => sub.remove();
  }, [open, minimized, canGoBack, onMinimize]);

  if (!open) return null;

  return (
    <Animated.View onLayout={(e) => setLayoutH(e.nativeEvent.layout.height)} pointerEvents={minimized ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, { zIndex: 60, backgroundColor: t.bg, transform: [{ translateY: ty }] }]}>
      <View style={{ paddingTop: top, backgroundColor: t.bg2, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
        <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
          {/* 收起（向下） */}
          <Pressable onPress={onMinimize} hitSlop={8} style={{ padding: 8 }}>
            <Icons.chevron size={21} color={t.tx} sw={2.2} style={{ transform: [{ rotate: '90deg' }] }} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.tx }}>在线预览</Text>
            <Text numberOfLines={1} style={{ fontSize: 11, color: t.tx3, fontFamily: 'monospace', maxWidth: '100%' }}>{hostOf(url)}</Text>
          </View>
          <Pressable onPress={() => ref.current?.reload()} hitSlop={8} style={{ padding: 8 }}><Icons.refresh size={18} color={t.tx2} sw={2} /></Pressable>
          <Pressable onPress={() => void Linking.openURL(url).catch(() => undefined)} hitSlop={8} style={{ padding: 8 }}><Icons.globe size={18} color={t.tx2} sw={2} /></Pressable>
          {/* 真正关闭 */}
          <Pressable onPress={onClose} hitSlop={8} style={{ padding: 8 }}><Icons.plus size={20} color={t.tx} sw={2.2} style={{ transform: [{ rotate: '45deg' }] }} /></Pressable>
        </View>
        {(loading || progress < 1) ? (
          <View style={{ height: 2, backgroundColor: t.bg4 }}>
            <View style={{ height: 2, width: `${Math.max(6, Math.round(progress * 100))}%`, backgroundColor: t.ac }} />
          </View>
        ) : null}
      </View>
      <WebView
        ref={ref}
        source={{ uri: url }}
        {...(Platform.OS === 'android' ? { cacheEnabled: true } : null)}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
        onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
        startInLoadingState
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }]}>
            <ActivityIndicator color={t.ac} />
          </View>
        )}
        style={{ flex: 1, backgroundColor: t.bg }}
      />
    </Animated.View>
  );
}
