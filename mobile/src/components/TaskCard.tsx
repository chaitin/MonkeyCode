import React from 'react';
import { Text, View } from 'react-native';
import type { ProjectTask } from '@/api/types';
import { Icons, providerIconForUrl } from '@/components/Icons';
import { ModelIcon } from '@/components/ModelIcon';
import { Card, Chip, StatusLine } from '@/components/ui';
import { formatTokens, modelDisplayName, taskDisplayName, taskTime } from '@/utils/format';
import { useTheme } from '@/theme';

export function TaskCard({ task, onPress }: { task: ProjectTask; onPress?: () => void }) {
  const t = useTheme();
  const model = modelDisplayName(task.model);
  const tokens = Number(task.stats?.total_tokens) || 0;
  const time = taskTime(task);
  const repo = task.full_name || task.repo_url;
  const RepoIcon = Icons[providerIconForUrl(task.repo_url)] ?? Icons.git;

  return (
    <Card onPress={onPress} style={{ paddingHorizontal: 19, paddingTop: 18, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusLine status={task.status} />
        {time ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>{time}</Text> : null}
      </View>

      <Text numberOfLines={2} style={{ marginTop: 11, fontSize: 17.5, fontWeight: '600', lineHeight: 23, letterSpacing: -0.3, color: t.tx }}>
        {taskDisplayName(task)}
      </Text>

      {repo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 }}>
          <RepoIcon size={13} color={t.tx3} sw={1.7} />
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.tx3, fontFamily: 'monospace', flexShrink: 1 }}>{repo}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        {model ? (
          <Chip style={{ flexShrink: 1 }}>
            <ModelIcon model={task.model?.model} size={14} />
            <Text numberOfLines={1} style={{ color: t.tx2, fontSize: 12, fontWeight: '500', flexShrink: 1 }}>{model}</Text>
          </Chip>
        ) : <View />}
        {tokens > 0 ? (
          <Text style={{ fontFamily: 'monospace', fontSize: 12, color: t.tx3, flexShrink: 0 }}>{formatTokens(tokens)} tokens</Text>
        ) : null}
      </View>
    </Card>
  );
}
