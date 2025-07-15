import { useEffect, useMemo, useState } from 'react';
import { getListUser } from '@/api/User';
import { Stack, MenuItem, Select } from '@mui/material';

import { useRequest } from 'ahooks';
import MemberStatistic from './components/memberStatistic';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { DomainUser } from '@/api/types';

export type TimeRange = '90d' | '24h';

const Dashboard = () => {
  const navigate = useNavigate();
  const { tab, id } = useParams();
  const [tabValue, setTabValue] = useState(tab || 'global');
  const [memberData, setMemberData] = useState<DomainUser | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  return (
    <Stack gap={2} sx={{ height: '100%' }}>
      <Stack direction='row' justifyContent='space-between' alignItems='center'>
        <Select
          labelId='time-range-label'
          value={timeRange}
          size='small'
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          sx={{ fontSize: 14 }}
        >
          <MenuItem value='24h'>最近 24 小时</MenuItem>
          <MenuItem value='90d'>最近 90 天</MenuItem>
        </Select>
      </Stack>

      <MemberStatistic memberData={memberData} timeRange={timeRange} />
    </Stack>
  );
};

export default Dashboard;
