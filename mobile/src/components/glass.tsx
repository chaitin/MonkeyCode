/**
 * 液态玻璃容器。
 * 用 expo-blur 实现真实毛玻璃（模糊层 + 薄边 + 顶部高光）。
 */
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

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
