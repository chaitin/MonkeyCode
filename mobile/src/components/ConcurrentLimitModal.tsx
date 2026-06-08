import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listTasks, stopTask } from '@/api/client';
import type { ProjectTask } from '@/api/types';
import { Icons } from '@/components/Icons';
import { Scrim } from '@/components/ui';
import { taskDisplayName } from '@/utils/format';
import { useTheme } from '@/theme';

/**
 * 并发任务数达上限弹窗（创建任务返回 code 10811 时弹出）。
 * 列出运行中/启动中的任务，让用户终止其中一个后重试。
 */
export function ConcurrentLimitModal({ visible, onClose, onStopped }: { visible: boolean; onClose: () => void; onStopped: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    listTasks({ page: 1, size: 10, status: 'pending,processing' as any })
      .then((list) => setTasks(list.filter((x) => x.status === 'pending' || x.status === 'processing')))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [visible]);

  const handleStop = async (taskId: string) => {
    setStoppingId(taskId);
    try {
      await stopTask(taskId);
      setTasks((prev) => prev.filter((x) => x.id !== taskId));
      onStopped();
    } catch { /* ignore */ } finally { setStoppingId(null); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Scrim onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '74%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line2, paddingBottom: insets.bottom + 16 }}>
        <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: t.line2, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
        <Text style={{ paddingHorizontal: 18, paddingTop: 8, fontSize: 16, fontWeight: '700', color: t.tx }}>并发任务数已达上限</Text>
        <Text style={{ color: t.tx2, fontSize: 13, paddingHorizontal: 18, paddingTop: 8, lineHeight: 20 }}>同时运行的任务数已达上限，终止下面其中一个后即可继续创建。</Text>
        <ScrollView style={{ paddingHorizontal: 16, marginTop: 10, maxHeight: 300 }}>
          {loading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={t.ac} /></View>
          ) : tasks.length === 0 ? (
            <Text style={{ color: t.tx3, fontSize: 13, textAlign: 'center', paddingVertical: 24 }}>暂无运行中的任务</Text>
          ) : (
            tasks.map((task) => (
              <View key={task.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: t.line, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 8 }}>
                <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, flex: 1 }}>{taskDisplayName(task)}</Text>
                <Pressable disabled={stoppingId === task.id} onPress={() => task.id && handleStop(task.id)} style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: t.red, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }, stoppingId === task.id && { opacity: 0.6 }]}>
                  {stoppingId === task.id ? <ActivityIndicator size="small" color={t.red} /> : <Icons.stop size={13} color={t.red} sw={2} />}
                  <Text style={{ color: t.red, fontSize: 12.5, fontWeight: '600' }}>终止</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
