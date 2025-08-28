import {
  getUserEventsDashboard,
  getUserHeatmapDashboard,
  getUserStatDashboard,
} from '@/api/Dashboard';
import { DomainUser } from '@/api/types';
import { SecondTimeRange } from '@/components/ui/calendar';
import { getRangeData, getRecent24HoursData, getRecentDaysData, getTimeRange } from '@/utils';
import { Grid2 as Grid } from '@mui/material';
import { useRequest } from 'ahooks';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { StyledHighlight } from './globalStatistic';
import LineCharts from './lineCharts';
import MemberInfo from './memberInfo';
import PieCharts from './pieCharts';
import { RecentActivityCard } from './statisticCard';

const MemberStatistic = ({
  memberData,
  userList,
  onMemberChange,
  timeDuration,
}: {
  memberData: DomainUser | null;
  userList: DomainUser[];
  onMemberChange: (data: DomainUser) => void;
  timeDuration: SecondTimeRange;
}) => {
  const { id } = useParams();
  const precision = useMemo(() => getTimeRange(timeDuration), [timeDuration]);
  const { data: userEvents } = useRequest(
    () =>
      getUserEventsDashboard({
        user_id: id || '',
        precision,
      }),
    {
      refreshDeps: [id],
      manual: false,
      ready: !!id,
    }
  );
  const { data: userStat } = useRequest(
    () =>
      getUserStatDashboard({
        user_id: id || '',
        ...timeDuration,
      }),
    {
      refreshDeps: [id, timeDuration],
      manual: false,
      ready: !!id,
    }
  );
  const { data: userHeatmap } = useRequest(
    () =>
      getUserHeatmapDashboard({
        user_id: id || '',
      }),
    {
      refreshDeps: [id],
      manual: false,
      ready: !!id,
    }
  );

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
    const chatChartData = getRangeData(timeDuration, chats, precision, label);
    const codeCompletionChartData = getRangeData(
      timeDuration,
      code_completions,
      precision,
      label
    );
    const codeLineChartData = getRangeData(timeDuration, lines_of_code, precision, label);
    const acceptedPerChartData = getRangeData(timeDuration, accepted_per, precision, label);
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
        overflowY: 'auto',
        borderRadius: '10px',
      }}
    >
      <Grid container size={9}>
        <Grid size={12}>
          <MemberInfo
            data={userHeatmap || {}}
            memberData={memberData}
            userList={userList}
            onMemberChange={onMemberChange}
          />
        </Grid>
        <Grid size={6}>
          <PieCharts
            title='工作模式-对话任务'
            data={userStat?.work_mode || []}
          />
        </Grid>
        <Grid size={6}>
          <PieCharts title='编程语言' data={userStat?.program_language || []} />
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
              共<StyledHighlight>{userStat?.total_chats || 0}</StyledHighlight>
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
              共修改
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
              平均采纳率为
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
