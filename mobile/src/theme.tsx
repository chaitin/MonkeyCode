/**
 * 设计令牌 —— 对齐「MonkeyCode 移动端」设计稿。
 * 浅色为默认主题，深色为变体；主题模式（跟随系统/浅色/深色）与点缀色可由用户选择并持久化。
 * 用法：const t = useTheme(); 内联样式里用 t.bg2 / t.ac 等；偏好用 useThemePrefs()。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme, type ColorValue } from 'react-native';

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface Theme {
  dark: boolean;
  bg: string; bg2: string; bg3: string; bg4: string;
  line: string; line2: string;
  tx: string; tx2: string; tx3: string;
  sb: string; track: string;
  ac: string; ac2: string; acInk: string; acTx: string; acGhost: string; acLine: string;
  add: string; addBg: string; addGut: string;
  del: string; delBg: string; delGut: string;
  amber: string; amberGhost: string;
  red: string; redGhost: string;
  termBg: string; termTx: string; termAcc: string;
  glassBg: string; glassBrd: string; glassHi: string; glassVeil: string;
  glassSolid: string; // 近不透明底色：Android 上 expo-blur 模糊很弱，用它替代毛玻璃保证可读性
  glassTint: 'light' | 'dark';
  shCard: ShadowStyle; shLift: ShadowStyle;
}

/** rgba 透明度辅助 */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── 点缀色（对齐设计稿 ACCENTS）──────────────────────────────────────────────
export interface AccentDef { label: string; fill: string; ac2: string; ink: string; txL: string; txD: string }
export const ACCENTS = {
  '清新绿': { label: '清新绿', fill: '#16b364', ac2: '#0f9a54', ink: '#ffffff', txL: '#0b8f4d', txD: '#46e08a' },
  '天空蓝': { label: '天空蓝', fill: '#3d83f5', ac2: '#2f6fe0', ink: '#ffffff', txL: '#2767d6', txD: '#74a6ff' },
  '葡萄紫': { label: '葡萄紫', fill: '#8b6cf0', ac2: '#7857e6', ink: '#ffffff', txL: '#6b46e0', txD: '#b39bff' },
  '蜜橘橙': { label: '蜜橘橙', fill: '#f29a35', ac2: '#e0851c', ink: '#ffffff', txL: '#b06f12', txD: '#f3bf5f' },
} as const satisfies Record<string, AccentDef>;
export type AccentKey = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

export type ThemeMode = 'system' | 'light' | 'dark';

const lightBase = {
  bg: '#f3f3f0', bg2: '#ffffff', bg3: '#f6f6f3', bg4: '#f0f0ec',
  line: 'rgba(20,20,16,0.06)', line2: 'rgba(20,20,16,0.10)',
  tx: '#1d1d1a', tx2: '#76766f', tx3: '#a8a89f',
  sb: '#1d1d1a', track: 'rgba(20,20,16,0.07)',
  add: '#0f9b62', addBg: 'rgba(15,155,98,0.10)', addGut: 'rgba(15,155,98,0.55)',
  del: '#d8524a', delBg: 'rgba(216,82,74,0.09)', delGut: 'rgba(216,82,74,0.5)',
  amber: '#bf821c', amberGhost: 'rgba(224,150,40,0.14)',
  red: '#d8524a', redGhost: 'rgba(216,82,74,0.10)',
  termBg: '#1c1d20', termTx: '#d6d7d2', termAcc: '#6fe6a3',
  glassBg: 'rgba(252,252,250,0.82)', glassBrd: 'rgba(255,255,255,0.75)',
  glassHi: 'rgba(255,255,255,0.95)', glassVeil: 'rgba(243,243,240,0.74)',
  glassSolid: 'rgba(250,250,247,0.97)',
  glassTint: 'light' as const,
  shCard: { shadowColor: '#1e1e18', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 2 },
  shLift: { shadowColor: '#1e1e18', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 28, elevation: 6 },
};

const darkBase = {
  bg: '#15161a', bg2: '#1f2025', bg3: '#282a30', bg4: '#31333a',
  line: 'rgba(255,255,255,0.07)', line2: 'rgba(255,255,255,0.12)',
  tx: '#edeeec', tx2: '#9fa0a0', tx3: '#6c6d70',
  sb: '#ffffff', track: 'rgba(255,255,255,0.09)',
  add: '#45cf86', addBg: 'rgba(69,207,134,0.13)', addGut: 'rgba(69,207,134,0.5)',
  del: '#f08079', delBg: 'rgba(240,128,121,0.12)', delGut: 'rgba(240,128,121,0.5)',
  amber: '#f0b454', amberGhost: 'rgba(240,180,84,0.15)',
  red: '#f0746a', redGhost: 'rgba(240,116,106,0.13)',
  termBg: '#101113', termTx: '#cdceca', termAcc: '#6fe6a3',
  glassBg: 'rgba(31,32,37,0.72)', glassBrd: 'rgba(255,255,255,0.13)',
  glassHi: 'rgba(255,255,255,0.16)', glassVeil: 'rgba(21,22,26,0.66)',
  glassSolid: 'rgba(26,27,32,0.96)',
  glassTint: 'dark' as const,
  shCard: { shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 18, elevation: 3 },
  shLift: { shadowColor: '#000000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.7, shadowRadius: 30, elevation: 8 },
};

function makeTheme(dark: boolean, accentKey: AccentKey): Theme {
  const a = ACCENTS[accentKey] ?? ACCENTS['清新绿'];
  const accent = {
    ac: a.fill, ac2: a.ac2, acInk: a.ink,
    acTx: dark ? a.txD : a.txL,
    acGhost: hexA(a.fill, dark ? 0.17 : 0.11),
    acLine: hexA(a.fill, 0.3),
  };
  return dark ? { dark: true, ...darkBase, ...accent } : { dark: false, ...lightBase, ...accent };
}

export const lightTheme = makeTheme(false, '清新绿');
export const darkTheme = makeTheme(true, '清新绿');

export const radius = { card: 24, lg: 16, md: 13, sm: 11, pill: 99, full: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, pad: 20, gap: 14, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26 } as const;

const ThemeContext = createContext<Theme>(lightTheme);

export interface ThemePrefs {
  mode: ThemeMode;
  accent: AccentKey;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: AccentKey) => void;
}
const PrefsContext = createContext<ThemePrefs>({ mode: 'system', accent: '清新绿', setMode: () => {}, setAccent: () => {} });

const STORE_MODE = 'mc.themeMode';
const STORE_ACCENT = 'mc.accent';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const sys = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [accent, setAccentState] = useState<AccentKey>('清新绿');

  useEffect(() => {
    (async () => {
      const [m, a] = await Promise.all([AsyncStorage.getItem(STORE_MODE), AsyncStorage.getItem(STORE_ACCENT)]);
      if (m === 'light' || m === 'dark' || m === 'system') setModeState(m);
      if (a && (a as string) in ACCENTS) setAccentState(a as AccentKey);
    })().catch(() => undefined);
  }, []);

  const setMode = useCallback((m: ThemeMode) => { setModeState(m); AsyncStorage.setItem(STORE_MODE, m).catch(() => undefined); }, []);
  const setAccent = useCallback((a: AccentKey) => { setAccentState(a); AsyncStorage.setItem(STORE_ACCENT, a).catch(() => undefined); }, []);

  const dark = mode === 'system' ? sys === 'dark' : mode === 'dark';
  const theme = useMemo(() => makeTheme(dark, accent), [dark, accent]);
  const prefs = useMemo<ThemePrefs>(() => ({ mode, accent, setMode, setAccent }), [mode, accent, setMode, setAccent]);

  return (
    <ThemeContext.Provider value={theme}>
      <PrefsContext.Provider value={prefs}>{children}</PrefsContext.Provider>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export const useThemePrefs = () => useContext(PrefsContext);

// ── 任务状态 → 展示（对齐设计稿 STATUS：运行中 / 已完成 / 已失败）──
export type StatusTone = 'green' | 'muted' | 'red';
export interface StatusInfo { label: string; tone: StatusTone; icon: string; dot: ColorValue; labelColor: ColorValue; running: boolean }

export function statusInfo(status: string | undefined, t: Theme): StatusInfo {
  switch (status) {
    case 'pending':
      return { label: '正在启动', tone: 'green', icon: 'spinner', dot: t.ac, labelColor: t.acTx, running: true };
    case 'processing':
      return { label: '运行中', tone: 'green', icon: 'spinner', dot: t.ac, labelColor: t.acTx, running: true };
    case 'error':
      return { label: '已失败', tone: 'red', icon: 'alert', dot: t.red, labelColor: t.red, running: false };
    case 'finished':
      return { label: '已完成', tone: 'muted', icon: 'checkCircle', dot: t.tx3, labelColor: t.tx3, running: false };
    default:
      return { label: status ?? '未知', tone: 'muted', icon: 'dot', dot: t.tx3, labelColor: t.tx3, running: false };
  }
}

export function toneColors(tone: StatusTone, t: Theme): { c: ColorValue; bg: ColorValue } {
  switch (tone) {
    case 'green': return { c: t.acTx, bg: t.acGhost };
    case 'red': return { c: t.red, bg: t.redGhost };
    case 'muted': return { c: t.tx2, bg: t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,20,16,0.05)' };
  }
}
