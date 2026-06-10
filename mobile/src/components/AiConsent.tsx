/**
 * AI 数据处理同意（满足 App Store 审核 Guideline 2.1：向第三方 AI 服务发送数据前需取得用户明确同意）。
 *
 * 在「即将把用户内容发给 AI」的入口处（任务会话页、新建任务页）首次弹出，用户明确点「同意并继续」后
 * 才放行；持久化到 AsyncStorage，之后不再打扰。点「暂不使用」则退出该页（不进行任何 AI 交互）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getBaseUrl } from '@/api/client';
import { useTheme } from '@/theme';

const AI_CONSENT_KEY = 'mc.aiConsent.v2';

export type AiConsentStatus = 'loading' | 'granted' | 'needed';

/** 读取/写入「AI 数据处理同意」状态。loading 期间不弹窗，避免闪现。仅 iOS（App Store 审核要求），Android 直接视为已同意。 */
export function useAiConsent() {
  const [status, setStatus] = useState<AiConsentStatus>(Platform.OS === 'ios' ? 'loading' : 'granted');
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    AsyncStorage.getItem(AI_CONSENT_KEY)
      .then((v) => { if (alive) setStatus(v === '1' ? 'granted' : 'needed'); })
      .catch(() => { if (alive) setStatus('needed'); });
    return () => { alive = false; };
  }, []);
  const grant = useCallback(() => {
    setStatus('granted');
    AsyncStorage.setItem(AI_CONSENT_KEY, '1').catch(() => undefined);
  }, []);
  return { status, grant };
}

export function AiConsentModal({ visible, onAgree, onDecline }: { visible: boolean; onAgree: () => void; onDecline: () => void }) {
  const t = useTheme();
  const openPrivacy = () => { Linking.openURL(`${getBaseUrl().replace(/\/+$/, '')}/privacy-policy`).catch(() => undefined); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline} statusBarTranslucent>
      {/* 居中确认对话框需要压暗背景（共享 Scrim 是透明的，底部 sheet 惯例不压暗，这里局部加）；拦截背景点击 */}
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
      <View style={{ position: 'absolute', left: 26, right: 26, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="box-none">
        <View style={{ width: '100%', backgroundColor: t.bg2, borderRadius: 22, borderWidth: 1, borderColor: t.line2, padding: 22, ...t.shLift }}>
          <Text style={{ color: t.tx, fontSize: 18, fontWeight: '700', marginBottom: 12 }}>使用 AI 编程助手</Text>
          <Text style={{ color: t.tx2, fontSize: 14, lineHeight: 22 }}>
            为给你提供 AI 编程协助，你在任务中提交的内容（你的指令、代码、文件、图片等）会被发送至 AI 模型进行处理，其中可能包含第三方 AI 服务商。点击「同意并继续」即表示你已知晓并同意上述数据处理方式。
          </Text>
          <Pressable onPress={openPrivacy} hitSlop={6} style={{ marginTop: 10 }}>
            <Text style={{ color: t.acTx, fontSize: 13, fontWeight: '600' }}>查看《隐私政策》</Text>
          </Pressable>
          <Pressable onPress={onAgree} style={({ pressed }) => [{ marginTop: 20, backgroundColor: t.ac, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }, pressed && { opacity: 0.85 }]}>
            <Text style={{ color: t.acInk, fontSize: 15, fontWeight: '700' }}>同意并继续</Text>
          </Pressable>
          <Pressable onPress={onDecline} style={{ marginTop: 8, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: t.tx3, fontSize: 14, fontWeight: '600' }}>暂不使用</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
