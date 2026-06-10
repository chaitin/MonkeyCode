/**
 * 左滑显示操作按钮的行 —— 用核心 PanResponder + Animated 实现，
 * 不依赖 react-native-gesture-handler（避免 GestureHandlerRootView 在新架构 Android 上吞掉点击的坑）。
 * 操作按钮只在拖动/展开时渲染，避免静止时从卡片圆角缝隙透出底色。
 */
import React, { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icons } from '@/components/Icons';
import { radius as R } from '@/theme';

export interface SwipeAction {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  onPress: () => void;
}

const ACTION_W = 78;

export function SwipeableRow({ children, actions, radius = R.card }: { children: React.ReactNode; actions: SwipeAction[]; radius?: number }) {
  const openW = actions.length * ACTION_W;
  const tx = useRef(new Animated.Value(0)).current;
  const baseRef = useRef(0);
  const openRef = useRef(false);
  const shownRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // 是否渲染操作区（拖动/展开时）

  const reveal = (v: boolean) => {
    if (shownRef.current !== v) { shownRef.current = v; setShown(v); }
  };

  const snap = (toOpen: boolean) => {
    openRef.current = toOpen;
    baseRef.current = toOpen ? -openW : 0;
    setOpen(toOpen);
    reveal(toOpen);
    Animated.spring(tx, { toValue: baseRef.current, useNativeDriver: false, bounciness: 0, speed: 20 }).start();
  };
  const close = () => snap(false);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      // iOS 关键：接管后拒绝把手势让给外层 FlatList 的原生滚动。默认会让出（返回 true），
      // 于是「接管→被终止回弹→再接管」死循环，表现为横滑疯狂抖动、根本滑不开（Android 仲裁不同，无此问题）。
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => reveal(true),
      onPanResponderMove: (_, g) => {
        let x = baseRef.current + g.dx;
        if (x > 0) x = 0;
        if (x < -openW - 24) x = -openW - 24;
        tx.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        const x = baseRef.current + g.dx;
        const toOpen = g.vx < -0.25 ? true : g.vx > 0.25 ? false : x < -openW / 2;
        snap(toOpen);
      },
      onPanResponderTerminate: () => snap(openRef.current),
    }),
  ).current;

  return (
    <View style={{ position: 'relative' }}>
      {/* 操作按钮（仅拖动/展开时渲染，靠右；卡片左滑后露出） */}
      {shown ? (
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', borderTopRightRadius: radius, borderBottomRightRadius: radius, overflow: 'hidden' }}>
          {actions.map((a) => {
            const I = Icons[a.icon];
            return (
              <Pressable key={a.key} onPress={() => { close(); a.onPress(); }} style={{ width: ACTION_W, backgroundColor: a.bg, alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                {I ? <I size={20} color={a.color} sw={1.9} /> : null}
                <Text style={{ color: a.color, fontSize: 12.5, fontWeight: '600' }}>{a.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* 前景卡片 */}
      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        {children}
        {open ? <Pressable onPress={close} style={StyleSheet.absoluteFill} /> : null}
      </Animated.View>
    </View>
  );
}
