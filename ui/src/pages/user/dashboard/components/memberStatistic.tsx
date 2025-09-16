import React, { useEffect, useMemo, useState } from 'react';
import { Grid } from '@mui/material';
import MemberInfo from '@/pages/dashboard/components/memberInfo';
import PieCharts from '@/pages/dashboard/components/pieCharts';
import LineCharts from '@/pages/dashboard/components/lineCharts';
import { RecentActivityCard } from '@/pages/dashboard/components/statisticCard';
import { useRequest } from 'ahooks';
import {
  getUserDashboardEvents,
  getUserDashboardHeatmap,
  getUserDashboardStat,
} from '@/api/UserDashboard';
import { StyledHighlight } from '@/pages/dashboard/components/globalStatistic';
import { getRecentDaysData, getRecent24HoursData } from '@/utils';
import { DomainUser } from '@/api/types';
import { TimeRange } from '../index';

interface TimeDuration {
  duration: number;
  precision: 'day' | 'hour';
}

const MemberStatistic = ({
  memberData,
  timeRange,
}: {
  memberData: DomainUser | null;
  timeRange: TimeRange;
}) => {
  const [timeDuration, setTimeDuration] = useState<TimeDuration>({
    duration: timeRange === '90d' ? 90 : 24,
    precision: timeRange === '90d' ? 'day' : 'hour',
  });

  const { data: userEvents } = useRequest(
    () =>
      getUserDashboardEvents({
        precision: timeDuration.precision,
      }),
    {
      manual: false,
    }
  );
  const { data: userStat } = useRequest(
    () =>
      getUserDashboardStat({
        ...timeDuration,
      }),
    {
      refreshDeps: [timeDuration],
      manual: false,
    }
  );
  const { data: userHeatmap } = useRequest(getUserDashboardHeatmap, {
    manual: false,
  });

  useEffect(() => {
    setTimeDuration({
      duration: timeRange === '90d' ? 90 : 24,
      precision: timeRange === '90d' ? 'day' : 'hour',
    });
  }, [timeRange]);

  const getRangeData = (
    data: Record<string, number>[],
    timeRange: TimeRange,
    label: { keyLabel?: string; valueLabel?: string } = { valueLabel: 'value' }
  ) => {
    return timeRange === '90d'
      ? getRecentDaysData(data, label)
      : getRecent24HoursData(data, label);
  };

  const {
    chatChartData,
    codeCompletionChartData,
    codeLineChartData,
    acceptedPerChartData,
  } = useMemo(() => {
    const {
      accepted_per = [],
      chats = [],
      code_completions = [],
      lines_of_code = [],
    } = userStat || {};
    const label = { valueLabel: 'value' };
    const chatChartData = getRangeData(chats, timeRange, label);
    const codeCompletionChartData = getRangeData(
      code_completions,
      timeRange,
      label
    );
    const codeLineChartData = getRangeData(lines_of_code, timeRange, label);
    const acceptedPerChartData = getRangeData(accepted_per, timeRange, label);
    return {
      chatChartData,
      codeCompletionChartData,
      codeLineChartData,
      acceptedPerChartData,
    };
  }, [userStat]);
  return (
    <Grid
      container
      spacing={2}
      sx={{
        overflow: 'auto',
        borderRadius: '10px',
      }}
    >
      <Grid container size={9}>
        <Grid size={12}>
          <MemberInfo data={userHeatmap || {}} memberData={memberData} />
        </Grid>
        <Grid size={6}>
          <PieCharts
            title='工作模式-对话任务'
            extra={timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}
            data={userStat?.work_mode || []}
          />
        </Grid>
        <Grid size={6}>
          <PieCharts
            title='编程语言'
            extra={timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}
            data={userStat?.program_language || []}
          />
        </Grid>
      </Grid>
      <Grid size={3}>
        <RecentActivityCard data={userEvents || []} />
      </Grid>
      <Grid size={6}>
        <LineCharts
          title='对话任务'
          data={chatChartData}
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}共
              <StyledHighlight>{userStat?.total_chats || 0}</StyledHighlight>
              个对话任务
            </>
          }
        />
      </Grid>
      <Grid size={6}>
        <LineCharts
          title='补全任务'
          data={codeCompletionChartData}
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}共
              <StyledHighlight>
                {userStat?.total_completions || 0}
              </StyledHighlight>
              个补全任务
            </>
          }
        />
      </Grid>
      <Grid size={6}>
        <LineCharts
          title='代码量'
          data={codeLineChartData}
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}共修改
              <StyledHighlight>
                {userStat?.total_lines_of_code || 0}
              </StyledHighlight>
              行代码
            </>
          }
        />
      </Grid>
      <Grid size={6}>
        <LineCharts
          title='补全任务采纳率'
          data={acceptedPerChartData}
          formatValueTooltip={(value) => `${value.toFixed(2)}%`}
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}平均采纳率为
              <StyledHighlight>
                {(userStat?.total_accepted_per || 0).toFixed(2)}
              </StyledHighlight>
              %
            </>
          }
        />
      </Grid>
    </Grid>
  );
};

export default MemberStatistic;
