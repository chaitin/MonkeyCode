/**
 * 共享展示型基础组件 —— 对齐设计稿 ui.jsx（卡片 / 胶囊 / 进度 / 玻璃头部 / 选择面板等）。
 * 全部基于 useTheme()，浅色为默认、深色为变体。
 */
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Glass } from '@/components/glass';
import { Icons, Spinner } from '@/components/Icons';
import { radius, spacing, statusInfo, toneColors, useTheme, type Theme } from '@/theme';

// MonkeyCode 猴子 logo（随主题：浅色主题用深色猴子，深色主题用亮色猴子）
const MONKEY_LIGHT = require('../../assets/logo-light.png'); // 深色猴子(透明底) → 浅色背景
const MONKEY_DARK = require('../../assets/logo-dark.png');   // 亮色猴子(深色圆底) → 深色背景
export function MonkeyLogo({ size = 40, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  const t = useTheme();
  return <Image source={t.dark ? MONKEY_DARK : MONKEY_LIGHT} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}

// ── 弹窗点击关闭区：去掉全屏灰色/毛玻璃遮罩（BlurView 实时模糊开销大，也是弹出变慢的主因）。
// 只保留一个透明点击层用于点空白关闭；面板本身靠阴影 + 顶部描边与内容区分。
export function Scrim({ onPress }: { onPress?: () => void }) {
  return <Pressable style={{ flex: 1 }} onPress={onPress} />;
}

// ── 执行计时：从本轮开始时间起按 ~0.2s 刷新，显示「耗时 X.X 秒」（对齐 web 端）─────
export function RunTimer({ startMs, style }: { startMs: number; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, (now - startMs) / 1000);
  return <Text style={[{ color: t.tx3, fontSize: 12, fontFamily: 'monospace' }, style]}>耗时 {sec.toFixed(1)} 秒</Text>;
}

// ── 「正在处理」打字动画：三个圆点依次淡入淡出，垂直居中（替代静态省略号）──────────
export function TypingDots({ color, size = 4, gap = 3.5 }: { color?: string; size?: number; gap?: number }) {
  const t = useTheme();
  const c = color ?? t.acTx;
  const dots = React.useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;
  React.useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay((2 - i) * 180),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dots]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      {dots.map((v, i) => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, opacity: v }} />
      ))}
    </View>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({ children, style, onPress }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base: ViewStyle = { backgroundColor: t.bg2, borderRadius: radius.card, ...t.shCard };
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { transform: [{ scale: 0.985 }], ...t.shLift }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

// ── Pill / Chip ─────────────────────────────────────────────────────────────
export function Pill({ children, color, bg, style }: { children: React.ReactNode; color?: string; bg?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 27, paddingHorizontal: 12, borderRadius: 99, backgroundColor: bg }, style]}>
      {typeof children === 'string' ? <Text style={{ color, fontSize: 12.5, fontWeight: '600' }}>{children}</Text> : children}
    </View>
  );
}

export function Chip({ children, color, bg, style }: { children: React.ReactNode; color?: string; bg?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: bg ?? t.bg4 }, style]}>
      {React.Children.map(children, (c) => (typeof c === 'string' ? <Text style={{ color: color ?? t.tx2, fontSize: 12, fontWeight: '500' }}>{c}</Text> : c))}
    </View>
  );
}

// ── 状态行（任务卡：圆点 + 文案，运行中带脉冲）──────────────────────────────
export function StatusLine({ status }: { status?: string }) {
  const t = useTheme();
  const s = statusInfo(status, t);
  const pulse = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!s.running) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [s.running, pulse]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Animated.View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: s.dot, opacity: s.running ? pulse : 1 }} />
      <Text style={{ color: s.labelColor, fontSize: 13, fontWeight: '600' }}>{s.label}</Text>
    </View>
  );
}

// ── 状态徽标（迷你卡：胶囊 + 图标）────────────────────────────────────────────
export function StatusBadge({ status }: { status?: string }) {
  const t = useTheme();
  const s = statusInfo(status, t);
  const tc = toneColors(s.tone, t);
  const I = Icons[s.icon] ?? Icons.dot;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingHorizontal: 10, borderRadius: 99, backgroundColor: tc.bg as string }}>
      {s.running ? <Spinner size={13} color={tc.c as string} sw={2} /> : <I size={13} color={tc.c as string} sw={2} />}
      <Text style={{ color: tc.c as string, fontSize: 12, fontWeight: '600' }}>{s.label}</Text>
    </View>
  );
}

// ── 仓库 / 分支行 ─────────────────────────────────────────────────────────────
export function RepoLine({ repo, branch, color }: { repo?: string; branch?: string; color?: string }) {
  const t = useTheme();
  const c = color ?? t.tx3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0, flexShrink: 1 }}>
      <Icons.git size={13} color={c} sw={1.7} style={{ opacity: 0.85 }} />
      <Text numberOfLines={1} style={{ color: c, fontSize: 12, fontFamily: 'monospace', flexShrink: 1 }}>{repo}</Text>
      {branch ? (
        <>
          <Text style={{ color: c, opacity: 0.4 }}>·</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icons.branch size={12} color={c} sw={1.7} />
            <Text style={{ color: c, fontSize: 12, fontFamily: 'monospace' }}>{branch}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── diff 统计 ─────────────────────────────────────────────────────────────────
export function DiffStat({ add, del, files }: { add?: number; del?: number; files?: number }) {
  const t = useTheme();
  if (!add && !del) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      {files ? <Text style={{ color: t.tx3, fontSize: 12, fontWeight: '500' }}>{files} 个文件</Text> : null}
      {add ? <Text style={{ color: t.add, fontSize: 12, fontWeight: '600', fontFamily: 'monospace' }}>+{add}</Text> : null}
      {del ? <Text style={{ color: t.del, fontSize: 12, fontWeight: '600', fontFamily: 'monospace' }}>−{del}</Text> : null}
    </View>
  );
}

// ── 进度环 ────────────────────────────────────────────────────────────────────
export function Ring({ value, size = 34, sw = 3.2, color }: { value: number; size?: number; sw?: number; color?: string }) {
  const t = useTheme();
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.track} strokeWidth={sw} />
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? t.ac} strokeWidth={sw}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
    </Svg>
  );
}

// ── 进度条 ────────────────────────────────────────────────────────────────────
export function Track({ value, height = 6 }: { value: number; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: 99, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${Math.max(0, Math.min(1, value)) * 100}%`, borderRadius: 99, backgroundColor: t.ac }} />
    </View>
  );
}

// ── 大标题（随内容滚动）─────────────────────────────────────────────────────────
export function BigTitle({ title, sub }: { title: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing.pad, paddingTop:8,  paddingBottom: 2 }}>
      <Text style={{ fontSize: 31, fontWeight: '500', letterSpacing: -0.9, color: t.tx, lineHeight: 39 }}>{title}</Text>
      {sub ? <Text style={{ fontSize: 13, color: t.tx3, marginTop: 6, fontWeight: '500' }}>{sub}</Text> : null}
    </View>
  );
}

// ── 圆形图标按钮 ──────────────────────────────────────────────────────────────
export function IconButton({ icon, onPress, size = 40, color, sw = 2, iconSize = 22, style }: { icon: string; onPress?: () => void; size?: number; color?: string; sw?: number; iconSize?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const I = Icons[icon] ?? Icons.dot;
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [{ width: size, height: size, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: t.bg3 }, style]}>
      <I size={iconSize} color={color ?? t.tx} sw={sw} />
    </Pressable>
  );
}

// ── 头像按钮（有头像图则用图，否则实色品牌绿 + 图标）──────────────────────────────
export function Avatar({ onPress, size = 40, uri }: { onPress?: () => void; size?: number; uri?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width: size, height: size, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ac, overflow: 'hidden' }, t.shCard, pressed && { transform: [{ scale: 0.93 }] }]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 99 }} /> : <Icons.user size={size * 0.5} color={t.acInk} sw={1.9} />}
    </Pressable>
  );
}

// ── 主按钮（胶囊）────────────────────────────────────────────────────────────────
export function PrimaryButton({ label, icon, onPress, disabled, block, style }: { label: string; icon?: string; onPress?: () => void; disabled?: boolean; block?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const I = icon ? Icons[icon] : null;
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={({ pressed }) => [
      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: t.ac },
      block ? { height: 54, borderRadius: 18 } : { height: 44, paddingHorizontal: 18, borderRadius: 99 },
      t.shCard,
      disabled && { opacity: 0.4 },
      pressed && !disabled && { transform: [{ scale: 0.97 }] },
      style,
    ]}>
      {I ? <I size={block ? 18 : 17} color={t.acInk} sw={2.2} /> : null}
      <Text style={{ color: t.acInk, fontSize: block ? 16 : 14.5, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

// ── 浮动玻璃头部（根屏：滚动时才淡入的折叠标题栏）────────────────────────────────
// 未滚动时整条完全透明，大标题贴近状态栏；滚动后毛玻璃 + 居中标题一起淡入。
export function GlassTop({ title, right, collapsed }: { title: string; right?: React.ReactNode; collapsed: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const op = React.useRef(new Animated.Value(collapsed ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(op, { toValue: collapsed ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [collapsed, op]);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 45, opacity: op }}>
      <Glass radius={0} border intensity={52} style={{ borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
        <View style={{ height: insets.top }} />
        <View style={{ height: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.pad }}>
          <Text style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.tx }}>{title}</Text>
          <View style={{ marginLeft: 'auto' }}>{right}</View>
        </View>
      </Glass>
    </Animated.View>
  );
}

// ── 浮动玻璃导航（详情屏：返回 + 居中标题 + 右槽）─────────────────────────────────
export function GlassNav({ title, onBack, right, children }: { title?: string; onBack?: () => void; right?: React.ReactNode; children?: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Glass radius={0} border style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 45, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
      <View style={{ height: insets.top }} />
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        {onBack ? <IconButton icon="back" onPress={onBack} /> : <View style={{ width: 40 }} />}
        {title ? <Text numberOfLines={1} style={{ position: 'absolute', left: 56, right: 56, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.tx }}>{title}</Text> : null}
        <View style={{ marginLeft: 'auto' }}>{right}</View>
      </View>
      {children}
    </Glass>
  );
}

// ── 底部选择面板（仓库 / 模型）──────────────────────────────────────────────────
export interface PickerOption { key: string; title: string; sub?: string; icon?: string; disabled?: boolean; badge?: string }
export function PickerSheet({ title, options, selected, onPick, onClose, visible }: {
  title: string; options: PickerOption[]; selected?: string; onPick: (k: string) => void; onClose: () => void; visible: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Scrim onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '74%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16 }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
        <Text style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, fontSize: 16, fontWeight: '700', color: t.tx }}>{title}</Text>
        <ScrollView style={{ paddingHorizontal: 12 }}>
          {options.map((o) => {
            const on = o.key === selected;
            const I = o.icon ? Icons[o.icon] : null;
            return (
              <Pressable key={o.key} disabled={o.disabled} onPress={() => onPick(o.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: on ? t.acGhost : 'transparent', borderRadius: 13, marginBottom: 2, opacity: o.disabled ? 0.4 : 1 }}>
                {I ? <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}><I size={18} color={t.acTx} sw={1.8} /></View> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>{o.title}{o.disabled ? <Text style={{ color: t.tx3, fontWeight: '400', fontSize: 12 }}>　无额度</Text> : o.badge ? <Text style={{ color: t.acTx, fontWeight: '500', fontSize: 11.5 }}>　{o.badge}</Text> : null}</Text>
                  {o.sub ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 2, fontFamily: 'monospace' }}>{o.sub}</Text> : null}
                </View>
                {on ? <Icons.check size={18} color={t.ac} sw={2.4} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Toast（轻提示）────────────────────────────────────────────────────────────
export function Toast({ text, bottom = 108 }: { text: string; bottom?: number }) {
  const t = useTheme();
  const a = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.spring(a, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [a]);
  return (
    <Animated.View style={{ position: 'absolute', alignSelf: 'center', bottom, zIndex: 95, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 99, backgroundColor: t.tx, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }], ...t.shLift }}>
      <Icons.check size={15} color={t.ac} sw={2.6} />
      <Text style={{ color: t.bg, fontSize: 13.5, fontWeight: '600' }}>{text}</Text>
    </Animated.View>
  );
}

// ── 加载 / 空态 ───────────────────────────────────────────────────────────────
export function Centered({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm, backgroundColor: t.bg }, style]}>{children}</View>;
}

export function LoadingView({ label }: { label?: string }) {
  const t = useTheme();
  // 末尾省略号统一换成居中的打字点动画（如「连接对话中」「加载任务详情」）。
  const dots = !!label && label.endsWith('…');
  const trimmed = dots ? label!.slice(0, -1) : label;
  return (
    <Centered>
      <ActivityIndicator color={t.ac} />
      {label ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ color: t.tx2, fontSize: 13, textAlign: 'center' }}>{trimmed}</Text>
          {dots ? <TypingDots color={t.tx2} /> : null}
        </View>
      ) : null}
    </Centered>
  );
}

export function EmptyView({ title, subtitle, icon = 'sparkle' }: { title: string; subtitle?: string; icon?: string }) {
  const t = useTheme();
  const isError = icon === 'alert';
  const I = Icons[icon] ?? Icons.sparkle;
  return (
    <Centered>
      {isError ? (
        <View style={{ width: 64, height: 64, borderRadius: 99, backgroundColor: t.bg2, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line2, alignItems: 'center', justifyContent: 'center', marginBottom: 4, ...t.shCard }}>
          <I size={28} color={t.tx3} sw={1.8} />
        </View>
      ) : (
        <MonkeyLogo size={76} style={{ marginBottom: 6, opacity: 0.92 }} />
      )}
      <Text style={{ color: t.tx, fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {subtitle ? <Text style={{ color: t.tx2, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{subtitle}</Text> : null}
    </Centered>
  );
}

/** 行项（用于设置等）。 */
export function Row({ icon, label, value, onPress, divider, danger }: { icon?: string; label: string; value?: string; onPress?: () => void; divider?: boolean; danger?: boolean }) {
  const t = useTheme();
  const I = icon ? Icons[icon] : null;
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderColor: t.line }}>
      {I ? <I size={18} color={danger ? t.red : t.tx2} sw={1.8} /> : null}
      <Text style={{ fontSize: 14.5, fontWeight: '500', color: danger ? t.red : t.tx }}>{label}</Text>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {value ? <Text style={{ color: t.tx3, fontSize: 13 }}>{value}</Text> : null}
        {onPress ? <Icons.chevron size={16} color={t.tx3} sw={1.9} /> : null}
      </View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: t.bg3 }}>{content}</Pressable> : content;
}

export type { Theme };
export const styleHelpers = { spacing, radius };
