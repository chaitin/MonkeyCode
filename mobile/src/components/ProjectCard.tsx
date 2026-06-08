import React from 'react';
import { Text, View } from 'react-native';
import type { Project } from '@/api/types';
import { Icons, providerIcon } from '@/components/Icons';
import { Card, Chip } from '@/components/ui';
import { fromNow } from '@/utils/format';
import { useTheme, type Theme } from '@/theme';

export function ProjIcon({ size = 46, lit, t, platform }: { size?: number; lit: boolean; t: Theme; platform?: string }) {
  const I = Icons[providerIcon(platform)] ?? Icons.git;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: 'center', justifyContent: 'center', backgroundColor: lit ? t.acGhost : t.bg4 }}>
      <I size={size * 0.5} color={lit ? t.acTx : t.tx2} sw={1.8} />
    </View>
  );
}

export function ProjectCard({ project, onPress }: { project: Project; onPress?: () => void }) {
  const t = useTheme();
  // 列表接口的 project.tasks 仅含「当前活跃（进行中）」任务，没有总数
  const active = (project.tasks ?? []).length;
  const repo = project.full_name || project.repo_url;
  const RepoI = Icons[providerIcon(project.platform)] ?? Icons.git;

  return (
    <Card onPress={onPress} style={{ paddingHorizontal: 16, paddingVertical: 15 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <ProjIcon lit={active > 0} t={t} platform={project.platform} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text numberOfLines={1} style={{ fontSize: 16.5, fontWeight: '700', letterSpacing: -0.2, color: t.tx, flexShrink: 1 }}>{project.name || repo || '未命名项目'}</Text>
            {active > 0 ? <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: t.ac }} /> : null}
          </View>
          {repo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <RepoI size={12} color={t.tx3} sw={1.7} />
              <Text numberOfLines={1} style={{ fontSize: 12, color: t.tx3, fontFamily: 'monospace', flexShrink: 1 }}>{repo}</Text>
            </View>
          ) : null}
        </View>
        <Icons.chevron size={19} color={t.tx3} sw={1.9} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 13 }}>
        {active > 0 ? (
          <Chip color={t.acTx} bg={t.acGhost}><Text style={{ color: t.acTx, fontSize: 12, fontWeight: '500' }}>{active} 个进行中</Text></Chip>
        ) : (
          <Chip><Text style={{ color: t.tx3, fontSize: 12, fontWeight: '500' }}>暂无进行中</Text></Chip>
        )}
        <Text style={{ marginLeft: 'auto', color: t.tx3, fontSize: 12 }}>{fromNow(project.updated_at || project.created_at)}</Text>
      </View>
    </Card>
  );
}
