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
  const clipStyle = shadow ? radiusStyle : { ...radiusStyle, overflow: 'hidden' as const };

  // Android：expo-blur 的模糊很弱/不稳定，毛玻璃几乎透明 → 直接铺一层近不透明底色，保证浮层可读。
  if (Platform.OS === 'android') {
    return (
      <View style={[clipStyle, shadow && t.shLift, style]}>
        <View style={[StyleSheet.absoluteFill, radiusStyle, { backgroundColor: t.glassSolid }, borderStyle]} />
        {children}
      </View>
    );
  }

  return (
    <View style={[clipStyle, shadow && t.shLift, style]}>
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
