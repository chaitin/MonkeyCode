/**
 * 描边图标集 —— 1:1 移植设计稿 icons.jsx 的 SVG path（默认 1.7px 描边，currentColor）。
 */
import React from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect, type SvgProps } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  sw?: number; // stroke width
  style?: StyleProp<ViewStyle>;
}

type Base = IconProps & { children?: React.ReactNode; fill?: SvgProps['fill']; vb?: number };

const Ic = ({ size = 22, color = '#000', sw = 1.7, fill = 'none', children, vb = 24, style }: Base) => (
  <Svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill} stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {children}
  </Svg>
);

type IconFn = (p: IconProps) => React.ReactElement;

// Simple Icons TikTok/Douyin note silhouette (CC0-1.0).
const DOUYIN_MARK_PATH = 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z';

export const Icons: Record<string, IconFn> = {
  tasks: (p) => <Ic {...p}><Path d="M8 6h12M8 12h12M8 18h12" /><Circle cx={3.5} cy={6} r={1.4} fill={p.color} stroke="none" /><Circle cx={3.5} cy={12} r={1.4} fill={p.color} stroke="none" /><Circle cx={3.5} cy={18} r={1.4} fill={p.color} stroke="none" /></Ic>,
  folder: (p) => <Ic {...p}><Path d="M3 7.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6l1 1a2 2 0 0 0 1.4.6H19a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Ic>,
  user: (p) => <Ic {...p}><Circle cx={12} cy={8} r={3.6} /><Path d="M5 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5" /></Ic>,
  plus: (p) => <Ic {...p}><Path d="M12 5v14M5 12h14" /></Ic>,
  back: (p) => <Ic {...p}><Path d="M15 5l-7 7 7 7" /></Ic>,
  chevron: (p) => <Ic {...p}><Path d="M9 6l6 6-6 6" /></Ic>,
  send: (p) => <Ic {...p}><Path d="M12 19V5M6 11l6-6 6 6" /></Ic>,
  git: (p) => <Ic {...p}><Circle cx={6} cy={6} r={2.4} /><Circle cx={6} cy={18} r={2.4} /><Circle cx={18} cy={9} r={2.4} /><Path d="M6 8.4v7.2M18 11.4c0 3-2.5 4-6 4" /></Ic>,
  branch: (p) => <Ic {...p}><Circle cx={6} cy={5} r={2.2} /><Circle cx={6} cy={19} r={2.2} /><Circle cx={18} cy={7} r={2.2} /><Path d="M6 7.2v9.6M18 9.2c0 4-4 3-6 5" /></Ic>,
  file: (p) => <Ic {...p}><Path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z" /><Path d="M13 3.5V8a1 1 0 0 0 1 1h4" /></Ic>,
  download: (p) => <Ic {...p}><Path d="M12 4v10m0 0l-4-4m4 4l4-4M5 18.5h14" /></Ic>,
  upload: (p) => <Ic {...p}><Path d="M12 15V5m0 0L8 9m4-4l4 4M5 18.5h14" /></Ic>,
  calendar: (p) => <Ic {...p}><Rect x={3.5} y={5} width={17} height={15.5} rx={2.5} /><Path d="M3.5 9.5h17M8 3v4M16 3v4" /></Ic>,
  filePlus: (p) => <Ic {...p}><Path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z" /><Path d="M13 3.5V8a1 1 0 0 0 1 1h4" /><Path d="M12 12v5M9.5 14.5h5" /></Ic>,
  edit: (p) => <Ic {...p}><Path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z" /></Ic>,
  terminal: (p) => <Ic {...p}><Rect x={3} y={4.5} width={18} height={15} rx={2.2} /><Path d="M7 9.5l3 2.5-3 2.5M12.5 15h4" /></Ic>,
  search: (p) => <Ic {...p}><Circle cx={11} cy={11} r={6.5} /><Path d="M16 16l4 4" /></Ic>,
  check: (p) => <Ic {...p}><Path d="M5 12.5l4.5 4.5L19 6.5" /></Ic>,
  checkCircle: (p) => <Ic {...p}><Circle cx={12} cy={12} r={9} /><Path d="M8 12.2l2.6 2.6L16 9.4" /></Ic>,
  spinner: (p) => <Ic {...p}><Circle cx={12} cy={12} r={8.5} strokeOpacity={0.25} /><Path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" /></Ic>,
  alert: (p) => <Ic {...p}><Circle cx={12} cy={12} r={9} /><Path d="M12 7.5v5.5M12 16h.01" /></Ic>,
  info: (p) => <Ic {...p}><Circle cx={12} cy={12} r={9} /><Path d="M12 11.2v4.6" /><Circle cx={12} cy={7.9} r={1.15} fill={p.color} stroke="none" /></Ic>,
  pause: (p) => <Ic {...p}><Rect x={7} y={6} width={3.2} height={12} rx={1} /><Rect x={13.8} y={6} width={3.2} height={12} rx={1} /></Ic>,
  play: (p) => <Ic {...p} fill={p.color}><Path d="M8 6l11 6-11 6z" /></Ic>,
  stop: (p) => <Ic {...p}><Rect x={7} y={7} width={10} height={10} rx={2.2} fill={p.color} stroke="none" /></Ic>,
  diamond: (p) => <Ic {...p}><Path d="M5 9.5l3-4.5h8l3 4.5-7 9z M5 9.5h14" /></Ic>,
  logout: (p) => <Ic {...p}><Path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h6.5a1.5 1.5 0 0 0 1.5-1.5V17" /><Path d="M10 12h10m0 0l-3-3m3 3l-3 3" /></Ic>,
  mail: (p) => <Ic {...p}><Rect x={3.5} y={5.5} width={17} height={13} rx={2.4} /><Path d="M5 8l7 5.2L19 8" /></Ic>,
  at: (p) => <Ic {...p}><Circle cx={12} cy={12} r={3.8} /><Path d="M15.8 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" /></Ic>,
  slash: (p) => <Ic {...p}><Path d="M15 4L9 20" /></Ic>,
  attach: (p) => <Ic {...p}><Path d="M19 11.5l-7.1 7.1a4 4 0 0 1-5.7-5.7l7.7-7.7a2.6 2.6 0 0 1 3.7 3.7l-7.6 7.6a1.2 1.2 0 0 1-1.7-1.7l6.9-6.9" /></Ic>,
  copy: (p) => <Ic {...p}><Rect x={8.5} y={8.5} width={11} height={11} rx={2.2} /><Path d="M5.5 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5" /></Ic>,
  sparkle: (p) => <Ic {...p}><Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></Ic>,
  clock: (p) => <Ic {...p}><Circle cx={12} cy={12} r={8.5} /><Path d="M12 7.5V12l3 2" /></Ic>,
  dot: (p) => <Ic {...p}><Circle cx={12} cy={12} r={4} fill={p.color} stroke="none" /></Ic>,
  cube: (p) => <Ic {...p}><Path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><Path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></Ic>,
  shield: (p) => <Ic {...p}><Path d="M12 3l7 2.5V11c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V5.5z" /></Ic>,
  crown: (p) => <Ic {...p}><Path d="M12 6l4 6l5 -4l-2 10h-14l-2 -10l5 4z" /></Ic>,
  mic: (p) => <Ic {...p}><Path d="M12 3a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><Path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20.5h6" /></Ic>,
  refresh: (p) => <Ic {...p}><Path d="M20 11A8 8 0 0 0 6 6.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14 4.5l2-2M20 20v-4.5h-4.5" /></Ic>,
  more: (p) => <Ic {...p}><Circle cx={5} cy={12} r={1.6} fill={p.color} stroke="none" /><Circle cx={12} cy={12} r={1.6} fill={p.color} stroke="none" /><Circle cx={19} cy={12} r={1.6} fill={p.color} stroke="none" /></Ic>,
  arrowRight: (p) => <Ic {...p}><Path d="M5 12h14m0 0l-6-6m6 6l-6 6" /></Ic>,
  brain: (p) => <Ic {...p}><Path d="M9.5 4.5A2.5 2.5 0 0 0 7 7a2.5 2.5 0 0 0-1.5 4.5A2.5 2.5 0 0 0 7 16a2.5 2.5 0 0 0 2.5 2.5c.8 0 1.5-.4 2-1V5.5c-.5-.6-1.2-1-2-1zM14.5 4.5A2.5 2.5 0 0 1 17 7a2.5 2.5 0 0 1 1.5 4.5A2.5 2.5 0 0 1 17 16a2.5 2.5 0 0 1-2.5 2.5c-.8 0-1.5-.4-2-1V5.5c.5-.6 1.2-1 2-1z" /></Ic>,
  eye: (p) => <Ic {...p}><Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><Circle cx={12} cy={12} r={3} /></Ic>,
  eyeOff: (p) => <Ic {...p}><Path d="M4 4l16 16M9.5 9.6a3 3 0 0 0 4.2 4.3M6.3 6.4C3.9 7.9 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1M14 6c4.3 1 7.5 6 7.5 6s-.7 1.3-2 2.7" /></Ic>,
  server: (p) => <Ic {...p}><Rect x={4} y={4.5} width={16} height={6} rx={2} /><Rect x={4} y={13.5} width={16} height={6} rx={2} /><Path d="M7.5 7.5h.01M7.5 16.5h.01" /></Ic>,
  globe: (p) => <Ic {...p}><Circle cx={12} cy={12} r={9} /><Path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" /></Ic>,
  trash: (p) => <Ic {...p}><Path d="M4.5 7h15M9 7V5.4A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.4V7M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5" /></Ic>,
  key: (p) => <Ic {...p}><Circle cx={8} cy={8} r={4.2} /><Path d="M11 11l8 8M16 16l2-2M18.5 18.5l2-2" /></Ic>,
  lock: (p) => <Ic {...p}><Rect x={4.5} y={10.5} width={15} height={9.5} rx={2.6} /><Path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" /></Ic>,
  link: (p) => <Ic {...p}><Path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" /></Ic>,
  phone: (p) => <Ic {...p}><Rect x={6.5} y={2.5} width={11} height={19} rx={3} /><Path d="M10.5 18h3" /></Ic>,
  douyin: (p) => <Ic {...p}><Path d="M13 3v10.5a3.5 3.5 0 1 1-3-3.46" /><Path d="M13 3c.5 2.5 2 4 4.5 4.3" /></Ic>,
  githubLine: (p) => <Ic {...p}><Path d="M9 19c-4 1.2-4-2.1-5.5-2.5M15 21v-3.2c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.2a11.6 11.6 0 0 0-6 0C6.3 1.3 5.3 1.6 5.3 1.6a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 8c0 4.6 2.7 5.7 5.5 6-.4.4-.5.9-.5 1.6V21" /></Ic>,
  // 品牌标识（实心，currentColor）
  // Google Material Icons: smartphone（Apache-2.0）。
  phoneDevice: ({ size = 22, color = '#000', style }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path d="M17 1.01 7 1C5.9 1 5 1.9 5 3v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99ZM17 19H7V5h10v14Z" />
    </Svg>
  ),
  // 抖音与 TikTok 共用的标准实心音符轮廓；青/红偏移保留抖音品牌的双色效果。
  douyinBrand: ({ size = 22, style }) => (
    <Svg width={size} height={size} viewBox="-1 -1 26 26" style={style}>
      <Path transform="translate(-0.38 -0.22)" fill="#25F4EE" d={DOUYIN_MARK_PATH} />
      <Path transform="translate(0.38 0.22)" fill="#FE2C55" d={DOUYIN_MARK_PATH} />
      <Path fill="#111111" d={DOUYIN_MARK_PATH} />
    </Svg>
  ),
  // 支付宝标准品牌标识，品牌蓝 #1677FF。
  alipayBrand: ({ size = 22, style }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#1677FF" style={style}>
      <Path d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846C23.898 1.722 22.193 0 20.088 0H3.915C1.808 0 .102 1.722.102 3.846v16.31C.102 22.28 1.808 24 3.915 24h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809" />
    </Svg>
  ),
  apple: ({ size = 22, color = '#000', style }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path d="M16.42 12.72c-.02-2.24 1.83-3.32 1.91-3.37-1.04-1.52-2.66-1.73-3.24-1.75-1.38-.14-2.69.81-3.39.81s-1.79-.79-2.94-.77c-1.51.02-2.9.88-3.68 2.23-1.57 2.73-.4 6.76 1.13 8.97.75 1.08 1.64 2.3 2.81 2.25 1.13-.04 1.56-.73 2.92-.73s1.75.73 2.95.71c1.22-.02 1.99-1.1 2.74-2.19.86-1.26 1.21-2.47 1.23-2.54-.03-.01-2.42-.93-2.44-3.62zM14.19 6.15c.62-.75 1.04-1.8.93-2.84-.89.04-1.98.6-2.62 1.34-.58.67-1.08 1.74-.94 2.76 1 .08 2.01-.51 2.63-1.26z" />
    </Svg>
  ),
  github: ({ size = 22, color = '#000', style }) => (
    // GitHub Brand Toolkit 2026 Invertocat，替换已废弃的 2015–2025 版本。
    <Svg width={size} height={size} viewBox="0 0 98 96" fill={color} style={style}>
      <Path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252V91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 0 48.9043 0C21.8203 0 0 22.1074 0 49.1914C0 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008V83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" />
    </Svg>
  ),
  gitee: ({ size = 22, color = '#000', style }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path fillRule="evenodd" d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.593.592v1.482a.593.593 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.593.593 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296z" />
    </Svg>
  ),
  gitlab: ({ size = 22, color = '#000', style }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path fillRule="evenodd" d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z" />
    </Svg>
  ),
  gitea: ({ size = 22, color = '#000', style }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path fillRule="evenodd" d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.367 2.406 0 7.212-.004 7.212-.004s.458.004 1.08-.394c.535-.324 1.013-.893 1.013-.893s.492-.527 1.18-1.73c.21-.37.385-.729.538-1.068 0 0 2.107-4.471 2.107-8.823-.042-1.318-.367-1.55-.443-1.627-.156-.156-.366-.153-.366-.153s-4.475.252-6.792.306c-.508.011-1.012.023-1.512.027v4.474l-.634-.301c0-1.39-.004-4.17-.004-4.17-1.107.016-3.405-.084-3.405-.084s-5.399-.27-5.987-.324c-.187-.011-.401-.032-.648-.032zm.354 1.832h.111s.271 2.269.6 3.597C5.549 11.147 6.22 13 6.22 13s-.996-.119-1.641-.348c-.99-.324-1.409-.714-1.409-.714s-.73-.511-1.096-1.52C1.444 8.73 2.021 7.7 2.021 7.7s.32-.859 1.47-1.145c.395-.106.863-.12 1.072-.12zm8.33 2.554c.26.003.509.127.509.127l.868.422-.529 1.075a.686.686 0 0 0-.614.359.685.685 0 0 0 .072.756l-.939 1.924a.69.69 0 0 0-.66.527.687.687 0 0 0 .347.763.686.686 0 0 0 .867-.206.688.688 0 0 0-.069-.882l.916-1.874a.667.667 0 0 0 .237-.02.657.657 0 0 0 .271-.137 8.826 8.826 0 0 1 1.016.512.761.761 0 0 1 .286.282c.073.21-.073.569-.073.569-.087.29-.702 1.55-.702 1.55a.692.692 0 0 0-.676.477.681.681 0 1 0 1.157-.252c.073-.141.141-.282.214-.431.19-.397.515-1.16.515-1.16.035-.066.218-.394.103-.814-.095-.435-.48-.638-.48-.638-.467-.301-1.116-.58-1.116-.58s0-.156-.042-.27a.688.688 0 0 0-.148-.241l.516-1.062 2.89 1.401s.48.218.583.619c.073.282-.019.534-.069.657-.24.587-2.1 4.317-2.1 4.317s-.232.554-.748.588a1.065 1.065 0 0 1-.393-.045l-.202-.08-4.31-2.1s-.417-.218-.49-.596c-.083-.31.104-.691.104-.691l2.073-4.272s.183-.37.466-.497a.855.855 0 0 1 .35-.077z" />
    </Svg>
  ),
};

/** provider/platform -> 图标 key */
export function providerIcon(platform?: string): string {
  const p = (platform || '').toLowerCase();
  if (p === 'github') return 'github';
  if (p === 'gitlab') return 'gitlab';
  if (p === 'gitea') return 'gitea';
  if (p === 'gitee') return 'gitee';
  return 'git';
}

/** 从仓库 URL 推断 provider 图标 key（任务无 platform 字段时用） */
export function providerIconForUrl(url?: string): string {
  const u = (url || '').toLowerCase();
  if (u.includes('gitlab')) return 'gitlab';
  if (u.includes('gitea')) return 'gitea';
  if (u.includes('gitee')) return 'gitee';
  if (u.includes('github')) return 'github';
  return 'git';
}

/** 旋转动画图标（用于 spinner / running 状态）。 */
export function Spinner({ size = 16, color = '#000', sw = 2.2, style }: IconProps) {
  const rot = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [rot]);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ rotate: spin }] }, style]}>
      {Icons.spinner({ size, color, sw })}
    </Animated.View>
  );
}
