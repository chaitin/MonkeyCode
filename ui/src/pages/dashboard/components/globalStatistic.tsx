import {
  getCategoryStatDashboard,
  getStatisticsDashboard,
  getTimeStatDashboard,
  getUserCodeRankDashboard,
} from '@/api/Dashboard';
import { SecondTimeRange } from '@/components/ui/calendar';
import { getRecent60MinutesData, getTimeRange, getRangeData } from '@/utils';
import { Grid, styled } from '@mui/material';
import { useRequest } from 'ahooks';
import { useMemo } from 'react';
import BarCharts from './barCharts';
import LineCharts from './lineCharts';
import PieCharts from './pieCharts';
import { ContributionCard, UserCard } from './statisticCard';

export const StyledHighlight = styled('span')(({ theme }) => ({
  fontSize: 12,
  color: theme.palette.text.primary,
  padding: '0 4px',
}));

const GlobalStatistic = ({
  timeDuration,
}: {
  timeDuration: SecondTimeRange;
}) => {
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
  const precision = useMemo(() => getTimeRange(timeDuration), [timeDuration]);

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
      userActiveChartData: getRangeData(
        timeDuration,
        active_users,
        precision,
        label
      ),
      chatChartData: getRangeData(timeDuration, chats, precision, label),
      codeCompletionChartData: getRangeData(
        timeDuration,
        code_completions,
        precision,
        label
      ),
      codeLineChartData: getRangeData(
        timeDuration,
        lines_of_code,
        precision,
        label
      ),
      realTimeTokenChartData: getRecent60MinutesData(real_time_tokens, label),
      acceptedPerChartData: getRangeData(
        timeDuration,
        accepted_per,
        precision,
        label
      ),
    };
  }, [timeStatData, precision]);

  return (
    <Grid
      container
      spacing={2}
      sx={{
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
              共
              <StyledHighlight>
                {timeStatData?.total_users || 0}
              </StyledHighlight>
              个活跃用户数
            </>
          }
        />
      </Grid>
      <Grid size={3}>
        <ContributionCard data={userCodeRankData} />
      </Grid>
      <Grid size={4}>
        <PieCharts
          title='工作模式-对话任务'
          data={categoryStatData.work_mode || []}
        />
      </Grid>
      <Grid size={4}>
        <PieCharts
          title='编程语言'
          data={categoryStatData.program_language || []}
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
              共
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
              共
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
              共修改
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
          formatValueTooltip={(value) => `${value.toFixed(2)}%`}
          extra={
            <>
              平均采纳率为
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
