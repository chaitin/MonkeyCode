/**
 * 精致底部选择面板：
 *  - ModelSheet：按 groupModels 分组的模型选择/切换（带分组标题 + 徽章）。
 *  - SkillSheet：可用斜杠指令（技能）选择。
 */
import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Model } from '@/api/types';
import type { PortForwardInfo } from '@/api/control';
import { Icons, Spinner } from '@/components/Icons';
import { ModelIcon } from '@/components/ModelIcon';
import { groupModels, modelLabel } from '@/config';
import type { AvailableCommand } from '@/messages/handler';
import { Scrim } from '@/components/ui';
import { useTheme, type Theme } from '@/theme';

function rowLabel(m: Model, groupLabel: string): string {
  const full = modelLabel(m);
  const prefix = `${groupLabel} / `;
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

function badgeTone(badge: string | undefined, t: Theme): { c: string; bg: string } | null {
  if (!badge) return null;
  if (badge.includes('积分')) return { c: t.amber, bg: t.amberGhost };
  return { c: t.acTx, bg: t.acGhost };
}

function SheetShell({ title, subtitle, onClose, action, children }: { title: string; subtitle?: string; onClose: () => void; action?: React.ReactNode; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Scrim onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: t.bg2, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 14, ...t.shLift }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 6 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: t.tx }}>{title}</Text>
          {action}
        </View>
        {subtitle ? <Text style={{ paddingHorizontal: 18, paddingTop: 3, fontSize: 12.5, color: t.tx3 }}>{subtitle}</Text> : null}
        <ScrollView style={{ marginTop: 8 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          {children}
        </ScrollView>
      </View>
    </>
  );
}

export function ModelSheet({ visible, models, selectedId, onPick, onClose, title = '选择模型' }: {
  visible: boolean; models: Model[]; selectedId?: string; onPick: (id: string) => void; onClose: () => void; title?: string;
}) {
  const t = useTheme();
  const groups = groupModels(models);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SheetShell title={title} onClose={onClose}>
        {groups.map((g) => {
          const bt = badgeTone(g.badge, t);
          return (
            <View key={g.key} style={{ marginTop: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 }}>
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.tx3, letterSpacing: 0.5 }}>{g.label}</Text>
                {bt ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: bt.bg }}>
                    <Text style={{ fontSize: 10.5, fontWeight: '600', color: bt.c }}>{g.badge}</Text>
                  </View>
                ) : null}
              </View>
              {g.models.map((m) => {
                const on = m.id === selectedId;
                return (
                  <Pressable key={m.id} onPress={() => onPick(m.id!)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 13, backgroundColor: on ? t.acGhost : 'transparent' }, pressed && !on && { backgroundColor: t.bg3 }]}>
                    <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <ModelIcon model={m.model} size={21} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: t.tx }}>{rowLabel(m, g.label)}</Text>
                    </View>
                    {on ? <Icons.check size={18} color={t.acTx} sw={2.4} /> : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
        {groups.length === 0 ? <Text style={{ textAlign: 'center', color: t.tx3, paddingVertical: 24 }}>暂无可用模型</Text> : null}
      </SheetShell>
    </Modal>
  );
}

export function SkillSheet({ visible, commands, onPick, onClose }: {
  visible: boolean; commands: AvailableCommand[]; onPick: (name: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SheetShell title="使用技能" onClose={onClose}>
        {commands.map((c) => (
          <Pressable key={c.name} onPress={() => onPick(c.name)} style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 }, pressed && { backgroundColor: t.acGhost }]}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ fontFamily: 'monospace', fontSize: 15.5, fontWeight: '600' }}>
                <Text style={{ color: t.acTx }}>/</Text>
                <Text style={{ color: t.tx }}>{c.name}</Text>
              </Text>
              {c.input?.hint ? <Text style={{ fontSize: 11.5, color: t.tx3, fontFamily: 'monospace' }}>{c.input.hint}</Text> : null}
            </View>
            {c.description ? <Text numberOfLines={2} style={{ fontSize: 13, color: t.tx3, marginTop: 3, lineHeight: 18 }}>{c.description}</Text> : null}
          </Pressable>
        ))}
        {commands.length === 0 ? <Text style={{ textAlign: 'center', color: t.tx3, paddingVertical: 28 }}>当前没有可用指令</Text> : null}
      </SheetShell>
    </Modal>
  );
}

export function PreviewSheet({ visible, ports, refreshing, activeUrl, onOpen, onRefresh, onClose }: {
  visible: boolean; ports: PortForwardInfo[]; refreshing?: boolean; activeUrl?: string; onOpen: (url: string) => void; onRefresh: () => void; onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SheetShell
        title="在线预览"
        subtitle="开发环境正在监听的端口"
        onClose={onClose}
        action={
          <Pressable onPress={onRefresh} hitSlop={8} style={{ padding: 6 }}>
            {refreshing ? <Spinner size={18} color={t.acTx} sw={2} /> : <Icons.refresh size={19} color={t.tx2} sw={2} />}
          </Pressable>
        }
      >
        {ports.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30, gap: 10 }}>
            <Icons.server size={26} color={t.tx3} sw={1.6} />
            <Text style={{ color: t.tx3, fontSize: 13 }}>开发环境中没有发现正在监听的端口</Text>
          </View>
        ) : (
          ports.slice().sort((a, b) => (a.access_url ? 0 : 1) - (b.access_url ? 0 : 1) || (a.port ?? 0) - (b.port ?? 0)).map((p) => {
            const url = p.access_url || '';
            const canAccess = !!url;
            const active = canAccess && !!activeUrl && url === activeUrl; // 当前正在预览的端口
            return (
              <View key={`${p.port}-${p.forward_id ?? ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 13, backgroundColor: active ? t.acGhost : t.bg3, borderWidth: 1, borderColor: active ? t.acLine : 'transparent', marginBottom: 8 }}>
                <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: active ? t.ac : t.bg4, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.server size={18} color={active ? t.acInk : canAccess ? t.acTx : t.tx3} sw={1.8} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: t.tx }}>端口 {p.port}</Text>
                    {active ? <View style={{ paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 99, backgroundColor: t.ac }}><Text style={{ fontSize: 10, fontWeight: '800', color: t.acInk }}>预览中</Text></View> : null}
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, marginTop: 2, fontFamily: canAccess ? 'monospace' : undefined }}>
                    {canAccess ? url : (p.error_message || '暂不可访问')}
                  </Text>
                </View>
                {canAccess ? (
                  <Pressable onPress={() => onOpen(url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: active ? t.acGhost : t.ac, borderWidth: active ? 1 : 0, borderColor: t.acLine }}>
                    <Text style={{ color: active ? t.acTx : t.acInk, fontSize: 13, fontWeight: '600' }}>{active ? '回到' : '访问'}</Text>
                    <Icons.arrowRight size={14} color={active ? t.acTx : t.acInk} sw={2.2} />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </SheetShell>
    </Modal>
  );
}

/**
 * 文本选择面板：倒置消息列表里原生选中不可用，长按消息时弹出此面板，
 * 在正常（非倒置）层里逐词选中复制，或一键复制全部。
 */
export function CopySheet({ visible, text, onClose, onCopyAll }: {
  visible: boolean; text: string; onClose: () => void; onCopyAll: (text: string) => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SheetShell
        title="选择文本"
        subtitle="长按选词复制，或点右上角复制全部"
        onClose={onClose}
        action={
          <Pressable onPress={() => onCopyAll(text)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 10, backgroundColor: t.acGhost }}>
            <Icons.copy size={14} color={t.acTx} />
            <Text style={{ color: t.acTx, fontSize: 13.5, fontWeight: '600' }}>复制全部</Text>
          </Pressable>
        }
      >
        <View style={{ paddingHorizontal: 6, paddingTop: 2, paddingBottom: 6 }}>
          {Platform.OS === 'ios' ? (
            // iOS 的 <Text selectable> 只能整段拷贝、无法选词；只读 TextInput（底层 UITextView，editable=NO 仍 selectable=YES）才支持原生选词。
            <TextInput multiline editable={false} scrollEnabled={false} value={text} style={{ color: t.tx, fontSize: 15, lineHeight: 23, padding: 0 }} />
          ) : (
            <Text selectable style={{ color: t.tx, fontSize: 15, lineHeight: 23 }}>{text}</Text>
          )}
        </View>
      </SheetShell>
    </Modal>
  );
}
