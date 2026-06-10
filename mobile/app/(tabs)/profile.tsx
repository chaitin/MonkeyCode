import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCheckinStatus, getSubscription, getWallet, listInvitations, resolveAssetUrl, submitCheckin } from '@/api/client';
import { checkAppUpdate, checkOta, currentOtaId, downloadAndApplyOta, installedAppVersion } from '@/updates/useOtaUpdate';
import { obtainCaptchaToken } from '@/api/captcha';
import type { InvitationItem, Subscription, Wallet } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { Icons } from '@/components/Icons';
import { BigTitle, Card, GlassTop, MonkeyLogo, Pill, Toast } from '@/components/ui';
import { ACCENTS, ACCENT_KEYS, spacing, useTheme, useThemePrefs, type Theme, type ThemeMode } from '@/theme';


const THEME_OPTIONS: { k: ThemeMode; label: string }[] = [
  { k: 'system', label: '跟随系统' },
  { k: 'light', label: '浅色' },
  { k: 'dark', label: '深色' },
];

function Appearance({ t }: { t: Theme }) {
  const { mode, accent, setMode, setAccent } = useThemePrefs();
  return (
    <Card style={{ padding: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5, marginBottom: 12 }}>外观</Text>

      <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.tx, marginBottom: 9 }}>主题</Text>
      <View style={{ flexDirection: 'row', backgroundColor: t.bg3, borderRadius: 12, padding: 3 }}>
        {THEME_OPTIONS.map((o) => {
          const on = mode === o.k;
          return (
            <Pressable key={o.k} onPress={() => setMode(o.k)} style={[{ flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.bg2 : 'transparent' }, on && t.shCard]}>
              <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? t.tx : t.tx2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.tx, marginTop: 16, marginBottom: 11 }}>点缀色</Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        {ACCENT_KEYS.map((k) => {
          const a = ACCENTS[k];
          const on = accent === k;
          return (
            <Pressable key={k} onPress={() => setAccent(k)} style={{ width: 40, height: 40, borderRadius: 99, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 2 : 0, borderColor: a.fill }}>
              <View style={{ width: on ? 30 : 38, height: on ? 30 : 38, borderRadius: 99, backgroundColor: a.fill, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icons.check size={16} color={a.ink} sw={2.8} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

// 产品相关入口（开源、AI 编程助手 MonkeyCode）
const ABOUT_LINKS: { icon: string; label: string; sub: string; url: string }[] = [
  { icon: 'globe', label: '官方网站', sub: 'monkeycode-ai.com', url: 'https://monkeycode-ai.com' },
  { icon: 'file', label: '帮助文档', sub: 'monkeycode.docs.baizhi.cloud', url: 'https://monkeycode.docs.baizhi.cloud/' },
  { icon: 'github', label: 'GitHub 开源仓库', sub: 'chaitin/MonkeyCode', url: 'https://github.com/chaitin/MonkeyCode' },
];

function About({ t }: { t: Theme }) {
  // 应用版本 = 原生安装包版本（来自安装包，与 OTA 无关）。对用户只有「版本」一个概念。
  const appVersion = installedAppVersion();
  // OTA 版本号(更新 id 短码)作为构建标识附在版本后面，便于排查当前跑的是哪一份。
  const otaId = currentOtaId();
  const verLine = `v${appVersion}${otaId ? ` · ${otaId.slice(0, 7)}` : ''}`;
  const open = (url: string) => { void Linking.openURL(url).catch(() => undefined); };
  const [otaBusy, setOtaBusy] = useState<null | 'checking' | 'downloading'>(null);

  const applyOtaNow = useCallback(() => {
    setOtaBusy('downloading');
    void downloadAndApplyOta().catch(() => {
      setOtaBusy(null);
      Alert.alert('更新失败', '下载失败，请检查网络后重试。');
    });
  }, []);

  // 统一的检查更新：先看有没有新的原生版本（新安装包）→ 引导去装；否则再看 OTA → 直接更新。
  const onCheck = useCallback(async () => {
    if (otaBusy) return;
    setOtaBusy('checking');
    // 1) 新的原生版本（新安装包）优先 —— OTA 推不动原生，必须装新包
    const app = await checkAppUpdate();
    if (app) {
      setOtaBusy(null);
      Alert.alert('发现新版本', `新版本 v${app.version} 可用，需前往下载安装新版本。`, [
        { text: '稍后', style: 'cancel' },
        { text: '去更新', onPress: () => { if (app.url) open(app.url); } },
      ]);
      return;
    }
    // 2) 原生已是最新 → 看 OTA（对用户就是「更新」，不提热更新）
    const r = await checkOta();
    setOtaBusy(null);
    if (r.status === 'disabled') { Alert.alert('检查更新', '开发模式下不可用，正式包才会检查更新。'); return; }
    // error（OTA 服务未上线/网络异常，拿不到有效数据）视为已是最新，不向用户报错
    if (r.status === 'error' || r.status === 'none') { Alert.alert('已是最新', `当前已是最新版本 ${verLine}。`); return; }
    Alert.alert('发现新版本', '有新版本可用，是否立即更新？\n（更新后将自动重启）', [
      { text: '取消', style: 'cancel' },
      { text: '立即更新', onPress: applyOtaNow },
    ]);
  }, [otaBusy, appVersion, applyOtaNow]);
  return (
    <Card style={{ padding: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5, marginBottom: 13 }}>关于</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[{ width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? t.bg3 : '#fff' }, t.shCard]}>
          <MonkeyLogo size={36} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: t.tx }}>MonkeyCode</Text>
          <Text style={{ fontSize: 12.5, color: t.tx3, marginTop: 2 }}>开源 AI 编程助手 · 长亭科技</Text>
        </View>
      </View>
      <View style={{ marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
        {ABOUT_LINKS.map((l, i) => {
          const I = Icons[l.icon] ?? Icons.globe;
          return (
            <Pressable key={l.url} onPress={() => open(l.url)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { opacity: 0.55 }]}>
              <I size={18} color={t.tx2} sw={1.8} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14.5, color: t.tx, fontWeight: '500' }}>{l.label}</Text>
                <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, fontFamily: 'monospace', marginTop: 1 }}>{l.sub}</Text>
              </View>
              <Icons.arrowRight size={15} color={t.tx3} sw={2} style={{ transform: [{ rotate: '-45deg' }] }} />
            </Pressable>
          );
        })}
        <Pressable onPress={onCheck} disabled={!!otaBusy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { opacity: 0.55 }]}>
          <Icons.refresh size={18} color={t.tx2} sw={1.8} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14.5, color: t.tx, fontWeight: '500' }}>检查更新</Text>
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 1 }}>
              {otaBusy === 'checking' ? '正在检查…' : otaBusy === 'downloading' ? '正在下载更新…' : `当前版本 ${verLine}`}
            </Text>
          </View>
          {otaBusy ? <ActivityIndicator size="small" color={t.tx3} /> : <Icons.arrowRight size={15} color={t.tx3} sw={2} />}
        </Pressable>
      </View>
    </Card>
  );
}

const INVITE_REWARD = 5000;

const PLAN_LIMITS = {
  basic: { basic: 30_000_000, pro: 0, ultra: 0 },
  pro: { basic: 30_000_000, pro: 30_000_000, ultra: 0 },
  ultra: { basic: 60_000_000, pro: 60_000_000, ultra: 60_000_000 },
} as const;
type PlanKey = keyof typeof PLAN_LIMITS;

function normalizePlan(plan?: string): PlanKey {
  if (plan === 'pro') return 'pro';
  if (plan === 'ultra' || plan === 'flagship') return 'ultra';
  return 'basic';
}
function planLabel(plan?: string): string {
  if (plan === 'ultra' || plan === 'flagship') return '旗舰会员';
  if (plan === 'pro') return '专业会员';
  return '基础会员';
}
function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(Math.floor(v / 100_000) / 10).toFixed(1)}M`;
  return v.toLocaleString('zh-CN');
}
const clamp = (v: number, total: number) => Math.min(Math.max(v, 0), total);

function QuotaBar({ name, total, remaining, t }: { name: string; total: number; remaining: number; t: Theme }) {
  const empty = total <= 0;
  const ratio = empty ? 0 : remaining / total;
  return (
    <View style={{ paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.tx }}>{name}</Text>
        <Text style={{ fontSize: 12, color: empty ? t.tx3 : t.tx2, fontFamily: 'monospace' }}>
          {empty ? '无额度' : `剩余 ${fmtTokens(remaining)} / ${fmtTokens(total)}`}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 99, backgroundColor: t.track, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${empty ? 0 : Math.max(2, ratio * 100)}%`, borderRadius: 99, backgroundColor: empty ? t.tx3 : t.ac }} />
      </View>
    </View>
  );
}

const CHECKIN_REWARD = 100;

function CheckinButton({ checkedIn, busy, onPress, t }: { checkedIn: boolean | null; busy: boolean; onPress: () => void; t: Theme }) {
  // 未知（加载中）：占位
  if (checkedIn === null) {
    return <View style={{ height: 38, width: 96, borderRadius: 99, backgroundColor: t.bg3, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="small" color={t.tx3} /></View>;
  }
  // 已签到：低调态
  if (checkedIn) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 15, borderRadius: 99, backgroundColor: t.bg3 }}>
        <Icons.checkCircle size={15} color={t.acTx} sw={2} />
        <Text style={{ color: t.tx2, fontSize: 13.5, fontWeight: '700' }}>今日已签到</Text>
      </View>
    );
  }
  // 可签到：主按钮
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: 99, backgroundColor: t.ac }, pressed && { transform: [{ scale: 0.96 }] }, busy && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator size="small" color={t.acInk} /> : <Icons.calendar size={15} color={t.acInk} sw={2} />}
      <Text style={{ color: t.acInk, fontSize: 13.5, fontWeight: '700' }}>{busy ? '签到中' : `签到 +${CHECKIN_REWARD}`}</Text>
    </Pressable>
  );
}

function InviteeStack({ items, t }: { items: InvitationItem[]; t: Theme }) {
  const show = items.slice(0, 4);
  if (show.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row' }}>
      {show.map((it, i) => (
        <View key={it.id ?? i} style={{ width: 24, height: 24, borderRadius: 99, backgroundColor: t.bg4, borderWidth: 2, borderColor: t.bg2, marginLeft: i ? -8 : 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          {resolveAssetUrl(it.avatar_url) ? <Image source={{ uri: resolveAssetUrl(it.avatar_url) }} style={{ width: 24, height: 24 }} /> : <Text style={{ fontSize: 10, color: t.tx2, fontWeight: '700' }}>{(it.name || '?').trim().charAt(0).toUpperCase()}</Text>}
        </View>
      ))}
    </View>
  );
}

export default function ProfileScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, baseUrl, logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [invitees, setInvitees] = useState<InvitationItem[]>([]);
  const [inviteCount, setInviteCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [checkedIn, setCheckedIn] = useState<boolean | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.allSettled([getWallet(), getSubscription(), listInvitations(), getCheckinStatus()]).then(([w, s, inv, c]) => {
        if (!active) return;
        if (w.status === 'fulfilled') setWallet(w.value);
        if (s.status === 'fulfilled') setSubscription(s.value);
        if (inv.status === 'fulfilled') { setInvitees(inv.value.items); setInviteCount(inv.value.count); }
        setCheckedIn(c.status === 'fulfilled' ? c.value : null);
        setLoadingWallet(false);
      });
      return () => { active = false; };
    }, []),
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1900);
  }, []);

  const copy = useCallback(async (text: string, msg: string) => {
    await Clipboard.setStringAsync(text);
    showToast(msg);
  }, [showToast]);

  const doCheckin = useCallback(async () => {
    if (checkingIn || checkedIn) return;
    setCheckingIn(true);
    try {
      const token = await obtainCaptchaToken(baseUrl); // 签到需 captcha_token（与登录同一套 PoW）
      await submitCheckin(token);
      setCheckedIn(true);
      showToast(`签到成功，+${CHECKIN_REWARD} 积分`);
      getWallet().then((w) => { if (w) setWallet(w); }).catch(() => undefined);
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : '签到失败，请重试');
    } finally {
      setCheckingIn(false);
    }
  }, [checkingIn, checkedIn, baseUrl, showToast]);

  const onLogout = () => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => { setBusy(true); await logout(); setBusy(false); router.replace('/login'); } },
    ]);
  };

  const name = user?.name || user?.username || user?.email || '用户';
  const email = user?.email || '';
  const avatarUrl = resolveAssetUrl(user?.avatar_url || user?.avatar);
  useEffect(() => { setAvatarBroken(false); }, [avatarUrl]);
  const credits = Math.floor((wallet?.balance ?? 0) / 1000).toLocaleString('zh-CN');
  const inviteLink = user?.id ? `${baseUrl}/?ic=${user.id}` : '';
  const planKey = normalizePlan(subscription?.plan);
  const limits = PLAN_LIMITS[planKey];
  const quotas = [
    { key: 'basic', label: '基础模型', total: limits.basic, remaining: clamp(wallet?.daily_basic_token_balance ?? 0, limits.basic) },
    { key: 'pro', label: '专业模型', total: limits.pro, remaining: clamp(wallet?.daily_pro_token_balance ?? 0, limits.pro) },
    { key: 'ultra', label: '旗舰模型', total: limits.ultra, remaining: clamp(wallet?.daily_ultra_token_balance ?? 0, limits.ultra) },
  ];
  const expiry = subscription?.expires_at && planKey !== 'basic' ? subscription.expires_at.slice(0, 10) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 116 }}
        onScroll={(e) => { const y = e.nativeEvent.contentOffset.y; setCollapsed((c) => (c !== y > 26 ? y > 26 : c)); }}
        scrollEventThrottle={16}
      >
        <BigTitle title="我的" />

        <View style={{ paddingHorizontal: spacing.pad, paddingTop: 12, gap: spacing.gap }}>
          {/* identity */}
          <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={[{ width: 60, height: 60, borderRadius: 99, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: avatarUrl && !avatarBroken ? t.ac : t.dark ? t.bg3 : '#fff' }, t.shCard]}>
              {avatarUrl && !avatarBroken
                ? <Image source={{ uri: avatarUrl }} onError={() => setAvatarBroken(true)} style={{ width: 60, height: 60, borderRadius: 99 }} />
                : <MonkeyLogo size={52} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', color: t.tx }}>{name}</Text>
              {email ? <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 13, color: t.tx2 }}>{email}</Text> : null}
              {user?.id ? (
                <Pressable onPress={() => copy(user.id!, '用户 ID 已复制')} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, backgroundColor: t.bg3 }, pressed && { opacity: 0.6 }]}>
                  <Text style={{ fontSize: 11, color: t.tx3, fontFamily: 'monospace' }}>ID {user.id.slice(0, 8)}</Text>
                  <Icons.copy size={11} color={t.tx3} sw={1.8} />
                </Pressable>
              ) : null}
            </View>
          </Card>

          {/* 积分：余额 + 每日签到 + 邀请 */}
          <Card style={{ padding: 16 }}>
            {/* 第一行：余额 + 签到（主行动） */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12.5, color: t.tx3, fontWeight: '500' }}>积分余额</Text>
                {loadingWallet
                  ? <ActivityIndicator size="small" color={t.tx3} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                  : <Text style={{ fontSize: 24, fontWeight: '800', color: t.acTx, fontFamily: 'monospace', letterSpacing: -0.5 }}>{credits}</Text>}
              </View>
              <CheckinButton checkedIn={checkedIn} busy={checkingIn} onPress={doCheckin} t={t} />
            </View>
            {/* 第二行：邀请 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
              <InviteeStack items={invitees} t={t} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, color: t.tx2, fontWeight: '600' }}>已邀请 {inviteCount} 人</Text>
                <Text style={{ fontSize: 11.5, color: t.tx3, marginTop: 1 }}>每邀请一位 +{INVITE_REWARD.toLocaleString('zh-CN')} 积分</Text>
              </View>
              {inviteLink ? (
                <Pressable onPress={() => copy(inviteLink, '邀请链接已复制，分享给好友')} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 13, borderRadius: 99, backgroundColor: t.acGhost }, pressed && { opacity: 0.6 }]}>
                  <Icons.copy size={13} color={t.acTx} sw={2} />
                  <Text style={{ color: t.acTx, fontSize: 12.5, fontWeight: '700' }}>邀请好友</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>

          {/* 会员 + 今日额度 */}
          <Card style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Pill color={t.acTx} bg={t.acGhost} style={{ height: 26 }}>
                <Icons.crown size={14} color={t.acTx} sw={1.9} />
                <Text style={{ color: t.acTx, fontSize: 13, fontWeight: '700' }}>{planLabel(subscription?.plan)}</Text>
              </Pill>
              <Text style={{ fontSize: 12.5, color: t.tx3 }}>{expiry ? `有效期至 ${expiry}` : '长期有效'}</Text>
            </View>
            <Text style={{ paddingTop: 8, paddingBottom: 2, fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.5 }}>今日额度</Text>
            {quotas.map((q) => <QuotaBar key={q.key} name={q.label} total={q.total} remaining={q.remaining} t={t} />)}
          </Card>

          {/* 外观：主题 + 点缀色 */}
          <Appearance t={t} />

          {/* 关于：产品信息 + 官网/文档/开源仓库 */}
          <About t={t} />

          {/* logout */}
          <Pressable onPress={onLogout} disabled={busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 15, borderRadius: 18, backgroundColor: t.bg2 }, t.shCard, pressed && { opacity: 0.7 }]}>
            <Icons.logout size={19} color={t.red} sw={1.9} />
            <Text style={{ color: t.red, fontSize: 15.5, fontWeight: '600' }}>退出登录</Text>
          </Pressable>
          <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 12, marginTop: 4 }}>Building with MonkeyCode</Text>
        </View>
      </ScrollView>

      <GlassTop title="我的" collapsed={collapsed} />
      {toast ? <Toast text={toast} bottom={insets.bottom + 116} /> : null}
    </View>
  );
}
