/**
 * 液态玻璃容器。
 * iOS 26+ 用 expo-glass-effect（系统 UIGlassEffect）；旧 iOS 回退 expo-blur 毛玻璃。
 * 换掉 UIVisualEffectView 方案的原因：它的高斯模糊会越过 bounds 向外渗出约一个
 * blur radius，iOS 26 上 RN 层的裁剪约束不住（Apple 标注裁剪其宿主为未定义行为），
 * composer 顶边上方会浮出一条把消息糊住的毛玻璃光晕。UIGlassEffect 严格按 bounds 渲染。
 */
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

// 懒加载 + 容错：OTA 包可能跑在还没编入 ExpoGlassEffect 原生模块的旧安装包上，
// 顶层 import 触发 requireNativeModule 抛错会直接崩 App；失败则永远走 BlurView 回退。
let glassEffectMod: typeof import('expo-glass-effect') | null | undefined;
function liquidGlassModule(): typeof import('expo-glass-effect') | null {
  if (glassEffectMod === undefined) {
    try {
      const mod = require('expo-glass-effect') as typeof import('expo-glass-effect');
      glassEffectMod = mod.isLiquidGlassAvailable() ? mod : null;
    } catch {
      glassEffectMod = null;
    }
  }
  return glassEffectMod;
}

interface GlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  intensity?: number;
  border?: boolean;
  shadow?: boolean;
}

export function Glass({ children, style, radius = 0, intensity = 36, border = true, shadow = false }: GlassProps) {
  const t = useTheme();
  const borderStyle = border ? { borderWidth: StyleSheet.hairlineWidth, borderColor: t.glassBrd } : null;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const baseRadius = flatStyle.borderRadius ?? radius;
  const radiusStyle = {
    borderRadius: baseRadius,
    borderTopLeftRadius: flatStyle.borderTopLeftRadius ?? baseRadius,
    borderTopRightRadius: flatStyle.borderTopRightRadius ?? baseRadius,
    borderBottomRightRadius: flatStyle.borderBottomRightRadius ?? baseRadius,
    borderBottomLeftRadius: flatStyle.borderBottomLeftRadius ?? baseRadius,
  };
  // 圆角裁剪只落在模糊层/底色层自身（radiusStyle + overflow）。外层容器绝不能加
  // overflow:'hidden'：给 UIVisualEffectView 的父视图加裁剪是 Apple 标注的未定义行为，
  // iOS 26+ 上会导致导航转场中挂载的毛玻璃整体失效（首次进页面无模糊，返回重进才恢复）。

  // Android：expo-blur 的模糊很弱/不稳定，毛玻璃几乎透明 → 直接铺一层近不透明底色，保证浮层可读。
  if (Platform.OS === 'android') {
    return (
      <View style={[radiusStyle, shadow && t.shLift, style]}>
        <View style={[StyleSheet.absoluteFill, radiusStyle, { backgroundColor: t.glassSolid }, borderStyle]} />
        {children}
      </View>
    );
  }

  // iOS 26+：系统液态玻璃。intensity 在此路径无效（材质强度由系统定），观感靠 veil 统一；
  // colorScheme 跟随 App 内主题开关而非系统外观，避免强制深/浅色时玻璃底色错位。
  const glassEffect = liquidGlassModule();
  if (glassEffect) {
    const { GlassView } = glassEffect;
    return (
      <View style={[radiusStyle, shadow && t.shLift, style]}>
        <GlassView glassEffectStyle="regular" colorScheme={t.glassTint} style={[StyleSheet.absoluteFill, radiusStyle]} />
        <View style={[StyleSheet.absoluteFill, radiusStyle, { backgroundColor: t.glassVeil }, borderStyle]} />
        {children}
      </View>
    );
  }

  return (
    <View style={[radiusStyle, shadow && t.shLift, style]}>
      <BlurView
        intensity={intensity}
        tint={t.glassTint}
        style={[StyleSheet.absoluteFill, radiusStyle, { overflow: 'hidden' }]}
      />
      <View style={[StyleSheet.absoluteFill, radiusStyle, { backgroundColor: t.glassVeil }, borderStyle]} />
      {children}
    </View>
  );
}
