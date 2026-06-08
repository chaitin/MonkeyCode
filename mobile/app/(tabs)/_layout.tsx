import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '@/components/glass';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const TAB_META: Record<string, { label: string; icon: string }> = {
  tasks: { label: '任务', icon: 'tasks' },
  projects: { label: '项目', icon: 'folder' },
  profile: { label: '我的', icon: 'user' },
};

function GlassDock({ state, navigation }: { state: any; navigation: any }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 8, alignItems: 'center' }}>
      <Glass radius={30} shadow border style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: 7 }}>
        {state.routes.map((route: any, i: number) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;
          const focused = state.index === i;
          const I = Icons[meta.icon];
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={{ minWidth: 60, height: 47, borderRadius: 21, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: focused ? t.acGhost : 'transparent' }}
            >
              <I size={22} color={focused ? t.acTx : t.tx2} sw={focused ? 2.1 : 1.8} />
              <Text style={{ fontSize: 10.5, fontWeight: '600', color: focused ? t.acTx : t.tx2, letterSpacing: 0.2 }}>{meta.label}</Text>
            </Pressable>
          );
        })}
        {/* <View style={{ width: 1, height: 28, backgroundColor: t.line2, marginHorizontal: 3 }} /> */}
        <Pressable
          onPress={() => router.push('/new-task')}
          style={({ pressed }) => [{ width: 47, height: 47, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ac }, pressed && { transform: [{ scale: 0.9 }] }]}
        >
          <Icons.plus size={24} color={t.acInk} sw={2.4} />
        </Pressable>
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <GlassDock {...(props as any)} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="projects" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
