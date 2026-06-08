import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, getProjectDetail, getTaskCount, listTasks } from '@/api/client';
import type { Project, ProjectTask } from '@/api/types';
import { Icons } from '@/components/Icons';
import { ProjIcon } from '@/components/ProjectCard';
import { Card, EmptyView, GlassNav, LoadingView, PrimaryButton, StatusBadge } from '@/components/ui';
import { taskDisplayName, taskTime } from '@/utils/format';
import { spacing, useTheme, type Theme } from '@/theme';

const PAGE_SIZE = 20;

function Stat({ label, value, accent, t }: { label: string; value: React.ReactNode; accent?: boolean; t: Theme }) {
  return (
    <View style={{ flex: 1, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12 }}>
      <Text style={{ fontSize: 11.5, color: t.tx3, fontWeight: '500' }}>{label}</Text>
      <Text style={{ marginTop: 6, fontSize: typeof value === 'string' && value.length > 4 ? 14 : 22, fontWeight: '800', color: accent ? t.acTx : t.tx }}>{value}</Text>
    </View>
  );
}

function MiniTask({ task, onPress, t }: { task: ProjectTask; onPress: () => void; t: Theme }) {
  return (
    <Card onPress={onPress} style={{ paddingHorizontal: 15, paddingVertical: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: t.tx, flexShrink: 1 }}>{taskDisplayName(task)}</Text>
        <StatusBadge status={task.status} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 }}>
        {task.branch ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icons.branch size={12} color={t.tx3} sw={1.7} />
            <Text style={{ color: t.tx3, fontSize: 12, fontFamily: 'monospace' }}>{task.branch}</Text>
          </View>
        ) : null}
        <Text style={{ marginLeft: 'auto', color: t.tx3, fontSize: 12 }}>{taskTime(task)}</Text>
      </View>
    </Card>
  );
}

export default function ProjectDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [runningCount, setRunningCount] = useState(0);
  const [issueCount, setIssueCount] = useState(0);
  const loadingRef = useRef(false);

  const fetchTasksPage = useCallback(async (pageNum: number, append: boolean) => {
    if (!id || loadingRef.current) return;
    loadingRef.current = true;
    if (append) setLoadingMore(true);
    try {
      const list = await listTasks({ project_id: id, page: pageNum, size: PAGE_SIZE });
      setTasks((prev) => (append ? [...prev, ...list] : list));
      setHasMore(list.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (e) {
      if (!append) setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [id]);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const d = await getProjectDetail(id);
      setProject(d);
      setIssueCount(d?.issues?.length ?? 0);
    } catch (e) { setError(e instanceof ApiError ? e.message : '加载失败'); }
    // 该项目下的任务计数：总数 + 进行中（走 project_id 过滤的任务列表 page_info.total）
    Promise.allSettled([
      getTaskCount({ project_id: id }),
      getTaskCount({ project_id: id, status: 'pending,processing' }),
    ]).then(([tot, run]) => {
      if (tot.status === 'fulfilled') setTotalCount(tot.value);
      if (run.status === 'fulfilled') setRunningCount(run.value);
    });
    await fetchTasksPage(1, false);
    setLoading(false);
    setRefreshing(false);
  }, [fetchTasksPage, id]);

  useEffect(() => { loadAll(); }, [loadAll]);
  const onRefresh = useCallback(() => { setRefreshing(true); setHasMore(true); loadAll(); }, [loadAll]);
  const onEndReached = useCallback(() => {
    if (!loadingRef.current && hasMore && !loading) fetchTasksPage(page + 1, true);
  }, [fetchTasksPage, hasMore, loading, page]);

  const repo = project?.full_name || project?.repo_url;

  const Header = project ? (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <ProjIcon size={56} lit t={t} platform={project.platform} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: t.tx }}>{project.name || repo || '项目'}</Text>
          {repo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 }}>
              <Icons.git size={13} color={t.tx3} sw={1.7} />
              <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.tx3, fontFamily: 'monospace', flexShrink: 1 }}>{repo}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <Stat label="任务" t={t} value={
          <Text>
            <Text style={{ color: t.acTx }}>{runningCount}</Text>
            <Text style={{ color: t.tx3, fontWeight: '700' }}> / {totalCount}</Text>
          </Text>
        } />
        <Stat label="需求" value={issueCount} accent={issueCount > 0} t={t} />
      </View>

      <Text style={{ paddingTop: 18, paddingBottom: 8, fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.6 }}>任务</Text>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {loading ? (
        <LoadingView label="加载项目…" />
      ) : error && !project && tasks.length === 0 ? (
        <EmptyView title="加载失败" subtitle={error} icon="alert" />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MiniTask task={item} t={t} onPress={() => router.push(`/task/${item.id}`)} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.gap }} />}
          ListHeaderComponent={Header}
          contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: spacing.pad, paddingBottom: insets.bottom + 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ac} progressViewOffset={insets.top + 52} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<View style={{ paddingTop: 20 }}><EmptyView title="还没有任务" subtitle="点下方按钮在此仓库发起一个" /></View>}
          ListFooterComponent={loadingMore ? <View style={{ paddingVertical: 18, alignItems: 'center' }}><ActivityIndicator color={t.ac} /></View> : null}
        />
      )}

      <GlassNav title={project?.name || '项目'} onBack={() => router.back()} />

      {project ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: t.bg }}>
          <PrimaryButton block icon="plus" label="在此仓库发起任务"
            onPress={() => router.push({ pathname: '/new-task', params: { repo: project.repo_url || '', repoName: project.name || '', projectId: project.id || '' } })} />
        </View>
      ) : null}
    </View>
  );
}
