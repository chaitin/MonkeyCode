/**
 * 语音输入按钮（composer / 新建任务共用）。三态：
 *  - idle：麦克风图标（底色/图标色可定制以适配不同容器）；
 *  - connecting/stopping：转圈；
 *  - 录音中：红色实心「停止」按钮 + 外圈脉冲，明确表示「正在录音，点击结束」。
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Icons, Spinner } from '@/components/Icons';
import { useTheme } from '@/theme';

export function MicButton({ status, active, onPress, disabled, idleBg = 'transparent', idleColor }: {
  status: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
  idleBg?: string;
  idleColor?: string;
}) {
  const t = useTheme();
  const busy = status === 'connecting' || status === 'stopping';
  const recording = active && !busy;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); pulse.setValue(0); };
  }, [recording, pulse]);

  if (busy) {
    return (
      <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={{ width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: t.acGhost }}>
        <Spinner size={16} color={t.acTx} sw={2} />
      </Pressable>
    );
  }

  if (recording) {
    return (
      <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', width: 30, height: 30, borderRadius: 99, backgroundColor: t.red, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] }} />
        <View style={{ width: 30, height: 30, borderRadius: 99, backgroundColor: t.red, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 11, height: 11, borderRadius: 3.5, backgroundColor: '#fff' }} />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={{ width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: idleBg, opacity: disabled ? 0.4 : 1 }}>
      <Icons.mic size={18} color={idleColor ?? t.tx3} sw={1.9} />
    </Pressable>
  );
}
