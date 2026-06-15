import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, listProjects } from '@/api/client';
import type { Project } from '@/api/types';
import { Icons } from '@/components/Icons';
import { ProjectCard } from '@/components/ProjectCard';
import { BigTitle, EmptyView, GlassTop, LoadingView, PrimaryButton } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

const PAGE_LIMIT = 20;

export default function ProjectsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const loadingRef = useRef(false);
  const didInitRef = useRef(false);

  const fetchPage = useCallback(async (nextCursor: string | undefined, mode: 'init' | 'refresh' | 'more') => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (mode === 'init') setLoading(true);
    if (mode === 'more') setLoadingMore(true);
    setError('');
    try {
      const res = await listProjects({ cursor: nextCursor, limit: PAGE_LIMIT });
      setProjects((prev) => (mode === 'more' ? [...prev, ...res.projects] : res.projects));
      setCursor(res.nextCursor);
      setHasMore(res.hasMore && !!res.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
      if (mode !== 'more') setProjects([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  // 进入页面即刷新（与任务页一致）：首次显示加载态，之后静默刷新，
  // 这样新建项目后返回列表能立即看到。
  useFocusEffect(
    useCallback(() => {
      fetchPage(undefined, didInitRef.current ? 'refresh' : 'init');
      didInitRef.current = true;
    }, [fetchPage]),
  );

  const onRefresh = useCallback(() => { setRefreshing(true); setHasMore(true); fetchPage(undefined, 'refresh'); }, [fetchPage]);
  const onEndReached = useCallback(() => {
    if (!loadingRef.current && hasMore && cursor) fetchPage(cursor, 'more');
  }, [cursor, fetchPage, hasMore]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {loading ? (
        <LoadingView label="加载项目…" />
      ) : error && projects.length === 0 ? (
        <EmptyView title="加载失败" subtitle={error} icon="alert" />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p, i) => p.id ?? String(i)}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: spacing.pad }}>
              <ProjectCard project={item} onPress={() => router.push(`/project/${item.id}`)} />
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.gap }} />}
          ListHeaderComponent={
            <View style={{ paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <BigTitle title="项目" sub={projects.length ? `共 ${projects.length}${hasMore ? '+' : ''} 个项目` : undefined} />
              </View>
              <Pressable onPress={() => router.push('/new-project')} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 14, borderRadius: 99, backgroundColor: t.acGhost, marginRight: spacing.pad, marginTop: 14 }, pressed && { opacity: 0.6 }]}>
                <Icons.plus size={16} color={t.acTx} sw={2.4} />
                <Text style={{ color: t.acTx, fontSize: 13.5, fontWeight: '700' }}>新建</Text>
              </Pressable>
            </View>
          }
          contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 116 }}
          onScroll={(e) => { const y = e.nativeEvent.contentOffset.y; setCollapsed((c) => (c !== y > 26 ? y > 26 : c)); }}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ac} progressViewOffset={insets.top + 46} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View style={{ paddingTop: 40 }}>
              <EmptyView title="暂无项目" subtitle="绑定 Git 身份并关联仓库后，即可创建项目" icon="folder" />
              <View style={{ paddingHorizontal: spacing.pad, marginTop: 18 }}>
                <PrimaryButton block label="新建项目" icon="plus" onPress={() => router.push('/new-project')} />
              </View>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={t.ac} /></View>
              : !hasMore && projects.length > 0 ? <Text style={{ textAlign: 'center', color: t.tx3, fontSize: 11, paddingVertical: 18 }}>没有更多了</Text>
              : null
          }
        />
      )}
      <GlassTop title="项目" collapsed={collapsed} />
    </View>
  );
}
