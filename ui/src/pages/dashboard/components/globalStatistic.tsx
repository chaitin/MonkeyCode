import React, { useEffect, useMemo, useState } from 'react';
import { Grid2 as Grid, styled } from '@mui/material';
import {
  getStatisticsDashboard,
  getUserCodeRankDashboard,
  getTimeStatDashboard,
  getCategoryStatDashboard,
} from '@/api/Dashboard';
import { useRequest } from 'ahooks';
import { UserCard } from './statisticCard';
import LineCharts from './lineCharts';
import PieCharts from './pieCharts';
import BarCharts from './barCharts';
import { ContributionCard } from './statisticCard';
import {
  getRecent90DaysData,
  getRecent60MinutesData,
  getRecent24HoursData,
} from '@/utils';
import { TimeRange } from '../index';

interface TimeDuration {
  duration: number;
  precision: 'day' | 'hour';
}

export const StyledHighlight = styled('span')(({ theme }) => ({
  fontSize: 12,
  color: theme.palette.text.primary,
  padding: '0 4px',
}));

const GlobalStatistic = ({ timeRange }: { timeRange: TimeRange }) => {
  const [timeDuration, settimeDuration] = useState<TimeDuration>({
    duration: timeRange === '90d' ? 90 : 24,
    precision: timeRange === '90d' ? 'day' : 'hour',
  });

  const { data: statisticsData } = useRequest(getStatisticsDashboard);

  const { data: userCodeRankData } = useRequest(
    () => getUserCodeRankDashboard(timeDuration),
    {
      refreshDeps: [timeDuration],
    }
  );

  const { data: timeStatData } = useRequest(
    () => getTimeStatDashboard(timeDuration),
    {
      refreshDeps: [timeDuration],
    }
  );

  const {
    data: categoryStatData = {
      program_language: [],
      work_mode: [],
    },
  } = useRequest(() => getCategoryStatDashboard(timeDuration), {
    refreshDeps: [timeDuration],
  });

  const getRangeData = (
    data: Record<string, number>[],
    timeRange: TimeRange,
    label: { keyLabel?: string; valueLabel?: string } = { valueLabel: 'value' }
  ) => {
    return timeRange === '90d'
      ? getRecent90DaysData(data, label)
      : getRecent24HoursData(data, label);
  };

  const {
    userActiveChartData,
    chatChartData,
    codeCompletionChartData,
    codeLineChartData,
    realTimeTokenChartData,
    acceptedPerChartData,
  } = useMemo(() => {
    const {
      active_users = [],
      chats = [],
      code_completions = [],
      lines_of_code = [],
      real_time_tokens = [],
      accepted_per = [],
    } = timeStatData || {};
    const label = { valueLabel: 'value' };
    return {
      userActiveChartData: getRangeData(active_users, timeRange, label),
      chatChartData: getRangeData(chats, timeRange, label),
      codeCompletionChartData: getRangeData(code_completions, timeRange, label),
      codeLineChartData: getRangeData(lines_of_code, timeRange, label),
      realTimeTokenChartData: getRecent60MinutesData(real_time_tokens, label),
      acceptedPerChartData: getRangeData(accepted_per, timeRange, label),
    };
  }, [timeStatData]);

  useEffect(() => {
    settimeDuration({
      duration: timeRange === '90d' ? 90 : 24,
      precision: timeRange === '90d' ? 'day' : 'hour',
    });
  }, [timeRange]);

  return (
    <Grid
      container
      spacing={2}
      sx={{
        height: '100%',
        overflow: 'auto',
        borderRadius: 2.5,
      }}
    >
      <Grid size={3}>
        <UserCard data={statisticsData} />
      </Grid>
      <Grid size={6}>
        <LineCharts
          title='活跃用户'
          data={userActiveChartData}
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}共
              <StyledHighlight>
                {timeStatData?.total_users || 0}
              </StyledHighlight>
              个活跃用户数
            </>
          }
        />
      </Grid>
      <Grid size={3}>
        <ContributionCard data={userCodeRankData} timeRange={timeRange} />
      </Grid>
      <Grid size={4}>
        <PieCharts
          title='工作模式-对话任务'
          data={categoryStatData.work_mode || []}
          extra={timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}
        />
      </Grid>
      <Grid size={4}>
        <PieCharts
          title='编程语言'
          data={categoryStatData.program_language || []}
          extra={timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}
        />
      </Grid>
      <Grid size={4}>
        <BarCharts
          title='实时使用情况'
          data={realTimeTokenChartData}
          extra='近 60 分钟'
        />
      </Grid>
      <Grid size={6}>
        <LineCharts
          title='对话任务'
          data={chatChartData}
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}共
              <StyledHighlight>
                {timeStatData?.total_chats || 0}
              </StyledHighlight>
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
                {timeStatData?.total_completions || 0}
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
                {timeStatData?.total_lines_of_code || 0}
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
          extra={
            <>
              {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}平均采纳率为
              <StyledHighlight>
                {(timeStatData?.total_accepted_per || 0).toFixed(2)}
              </StyledHighlight>
              %
            </>
          }
        />
      </Grid>
      {/* </Grid> */}
    </Grid>
  );
};

export default GlobalStatistic;
