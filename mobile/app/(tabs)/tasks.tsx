import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, deleteTask, listTasks, stopTask } from '@/api/client';
import type { ProjectTask } from '@/api/types';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TaskCard } from '@/components/TaskCard';
import { BigTitle, EmptyView, GlassTop, LoadingView } from '@/components/ui';
import { taskDisplayName } from '@/utils/format';
import { spacing, useTheme } from '@/theme';

const PAGE_SIZE = 20;

const FILTERS = [
  { k: 'running', label: '进行中', status: 'pending,processing' },
  { k: 'done', label: '已结束', status: 'finished,error' },
];
const statusFor = (k: string) => FILTERS.find((f) => f.k === k)?.status ?? '';

export default function TasksScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetching, setFetching] = useState(true); // 首屏/切换筛选时的拉取中
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('running');
  const [collapsed, setCollapsed] = useState(false);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(async (pageNum: number, mode: 'first' | 'more' | 'refresh', status: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (mode === 'more') setLoadingMore(true);
    else if (mode === 'first') setFetching(true);
    setError('');
    try {
      const list = await listTasks({ page: pageNum, size: PAGE_SIZE, status });
      setTasks((prev) => (mode === 'more' ? [...prev, ...list] : list));
      setHasMore(list.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
      if (mode !== 'more') setTasks([]);
    } finally {
      loadingRef.current = false;
      setFetching(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  // 首屏 + 切换筛选：清空并按该状态重新拉取（status 交给后端筛选，分页才正确）
  useEffect(() => {
    setTasks([]);
    setHasMore(true);
    fetchPage(1, 'first', statusFor(filter));
  }, [filter, fetchPage]);

  // 从新建任务等页面返回时静默刷新当前筛选
  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) { didMountRef.current = true; return; }
      fetchPage(1, 'refresh', statusFor(filter));
    }, [fetchPage, filter]),
  );

  const onRefresh = useCallback(() => { setRefreshing(true); setHasMore(true); fetchPage(1, 'refresh', statusFor(filter)); }, [fetchPage, filter]);
  const onEndReached = useCallback(() => {
    if (!loadingRef.current && hasMore) fetchPage(page + 1, 'more', statusFor(filter));
  }, [fetchPage, hasMore, page, filter]);

  const removeTask = useCallback((id: string) => setTasks((prev) => prev.filter((x) => x.id !== id)), []);

  const confirmStop = useCallback((task: ProjectTask) => {
    Alert.alert('终止任务', `确定终止「${taskDisplayName(task)}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '终止', style: 'destructive', onPress: async () => {
        try { await stopTask(task.id); removeTask(task.id); }
        catch (e) { Alert.alert('终止失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  }, [removeTask]);

  const confirmDelete = useCallback((task: ProjectTask) => {
    Alert.alert('删除任务', `删除「${taskDisplayName(task)}」？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteTask(task.id); removeTask(task.id); }
        catch (e) { Alert.alert('删除失败', e instanceof ApiError ? e.message : '请稍后重试'); }
      } },
    ]);
  }, [removeTask]);

  const Header = (
    <View>
      <BigTitle title="智能任务" />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: 8 }}>
        {FILTERS.map((f) => {
          const on = filter === f.k;
          return (
            <Pressable key={f.k} onPress={() => filter !== f.k && setFilter(f.k)} style={[{ height: 34, paddingHorizontal: 16, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.acGhost : t.bg2 }, !on && t.shCard]}>
              <Text style={{ fontSize: 13.5, fontWeight: '600', color: on ? t.ac : t.tx2 }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const running = item.status === 'pending' || item.status === 'processing';
          const del = { key: 'delete', label: '删除', icon: 'trash', color: '#fff', bg: t.red, onPress: () => confirmDelete(item) };
          const actions = running
            ? [{ key: 'stop', label: '终止', icon: 'stop', color: '#fff', bg: t.amber, onPress: () => confirmStop(item) }, del]
            : [del];
          return (
            <View style={{ paddingHorizontal: spacing.pad }}>
              <SwipeableRow actions={actions}>
                <TaskCard task={item} onPress={() => router.push(`/task/${item.id}`)} />
              </SwipeableRow>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.gap }} />}
        ListHeaderComponent={Header}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 116, flexGrow: 1 }}
        scrollIndicatorInsets={{ top: insets.top + 46 }}
        onScroll={(e) => { const y = e.nativeEvent.contentOffset.y; setCollapsed((c) => (c !== y > 26 ? y > 26 : c)); }}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ac} progressViewOffset={insets.top + 46} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          fetching ? (
            <View style={{ paddingTop: 60 }}><LoadingView label="加载任务…" /></View>
          ) : error ? (
            <View style={{ paddingTop: 40 }}><EmptyView title="加载失败" subtitle={error} icon="alert" /></View>
          ) : (
            <View style={{ paddingTop: 40 }}><EmptyView title={filter === 'running' ? '没有进行中的任务' : '还没有已结束的任务'} subtitle={filter === 'running' ? '点右下角 + 发起一个 AI 任务' : undefined} /></View>
          )
        }
        ListFooterComponent={
          loadingMore ? <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={t.ac} /></View>
            : !hasMore && tasks.length > 0 ? <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 11, paddingVertical: 18 }}>没有更多了</Text>
            : null
        }
      />
      <GlassTop title="任务" collapsed={collapsed} />
    </View>
  );
}
