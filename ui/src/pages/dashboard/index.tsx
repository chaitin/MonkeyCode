import { useEffect, useMemo, useState } from 'react';
import { getListUser } from '@/api/User';
import { Stack, Box } from '@mui/material';
import { CusTabs } from '@c-x/ui';
import GlobalStatistic from './components/globalStatistic';
import { useRequest } from 'ahooks';
import MemberStatistic from './components/memberStatistic';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { DomainUser } from '@/api/types';
import { v1LicenseList } from '@/api';
import { Calendar, RangeValue } from '@/components/ui/calendar';
import { subDays, subMonths, subWeeks } from 'date-fns';
import { getTimeRange } from '@/utils';

const get24HoursRange = () => {
  return {
    start: subDays(new Date(), 1),
    end: new Date(),
  };
};

const presets = {
  'last-1-days': {
    text: '最近 24 小时',
    ...get24HoursRange(),
  },
  'last-3-days': {
    text: '最近 3 天',
    start: subDays(new Date(), 3),
    end: new Date(),
  },
  'last-7-days': {
    text: '最近 7 天',
    start: subWeeks(new Date(), 1),
    end: new Date(),
  },
  'last-14-days': {
    text: '最近 14 天',
    start: subWeeks(new Date(), 2),
    end: new Date(),
  },
  'last-month': {
    text: '最近 1 月',
    start: subMonths(new Date(), 1),
    end: new Date(),
  },
  'last-3-months': {
    text: '最近 3 月',
    start: subMonths(new Date(), 3),
    end: new Date(),
  },
  'last-half-year': {
    text: '最近半年',
    start: subMonths(new Date(), 6),
    end: new Date(),
  },
  'last-year': {
    text: '最近一年',
    start: subMonths(new Date(), 12),
    end: new Date(),
  },
};
export type TimeRange = '90d' | '24h';

const Dashboard = () => {
  const navigate = useNavigate();
  const { tab, id } = useParams();
  const [tabValue, setTabValue] = useState(tab || 'global');
  const [memberData, setMemberData] = useState<DomainUser | null>(null);
  const [timeRange, setTimeRange] = useState<RangeValue>(
    presets['last-1-days']
  );

  const license = useRequest(() => {
    return v1LicenseList({});
  }).data;
  const { data: userData, refresh } = useRequest(
    () =>
      getListUser({
        page: 1,
        size: 99999,
      }),
    {
      manual: true,
      onSuccess: (res) => {
        if (id) {
          setMemberData(res.users?.find((item) => item.id === id) || null);
        } else {
          setMemberData(res.users?.[0] || null);
          navigate(`/dashboard/member/${res.users?.[0]?.id}`);
        }
      },
    }
  );
  const userList = useMemo(() => {
    return userData?.users || [];
  }, [userData]);
  useEffect(() => {
    if (tabValue === 'member') {
      refresh();
    }
  }, [tabValue]);

  const onMemberChange = (data: DomainUser) => {
    setMemberData(data);
    navigate(`/dashboard/member/${data.id}`);
  };

  const onTabChange = (value: string) => {
    setTabValue(value);
    navigate(`/dashboard/${value}`);
  };
  const handleTimeRangeChange = (value: any) => {
    if (value) {
      console.log(value)
      setTimeRange(value);
    } else {
      setTimeRange(get24HoursRange());
    }
  };

  const secondValue = useMemo(() => {
    return {
      start_at: timeRange.start
        ? Math.floor(timeRange.start?.getTime() / 1000)
        : 0,
      end_at: timeRange.end ? Math.floor(timeRange.end?.getTime() / 1000) : 0,
      precision: getTimeRange({
        start_at: timeRange.start
          ? Math.floor(timeRange.start?.getTime() / 1000)
          : 0,
        end_at: timeRange.end ? Math.floor(timeRange.end?.getTime() / 1000) : 0,
      }),
    };
  }, [timeRange]);

  return (
    <Stack gap={2} sx={{ height: '100%' }}>
      <Stack direction='row' gap={2} justifyContent='space-between' alignItems='center'>
        <CusTabs
          value={tabValue}
          onChange={onTabChange}
          list={[
            { label: '全局统计', value: 'global' },
            { label: '成员统计', value: 'member' },
          ]}
          sx={{
            borderColor: 'transparent',
            backgroundColor: '#fff',
            height: 'auto',
            borderRadius: 2.5,
            '.MuiTabs-indicator': {
              top: '0px',
              bottom: '0px',
              height: 'auto',
              borderRadius: '5px',
            },
            '.MuiTab-root': {
              lineHeight: '1.5 !important',
            },
          }}
        />
        <Box sx={{ py: '4px', pr: 5 }}>
          <Calendar
            allowClear
            disabled={license?.edition !== 2}
            onChange={handleTimeRangeChange}
            presets={presets}
            presetIndex={0}
            value={timeRange}
          />
        </Box>
      </Stack>

      {tabValue === 'global' && <GlobalStatistic timeDuration={secondValue} />}
      {tabValue === 'member' && (
        <MemberStatistic
          memberData={memberData}
          userList={userList}
          onMemberChange={onMemberChange}
          timeDuration={secondValue}
        />
      )}
    </Stack>
  );
};

export default Dashboard;
