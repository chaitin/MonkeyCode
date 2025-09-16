import Card from '@/components/card';
import { Stack, Box } from '@mui/material';
import { Table } from '@ctzhian/ui';
import dayjs from 'dayjs';
import { useRequest } from 'ahooks';
import { getAdminLoginHistory } from '@/api/Admin';
import { ColumnsType } from '@ctzhian/ui/dist/Table';
import { DomainListAdminLoginHistoryResp } from '@/api/types';
import User from '@/components/user';

type LoginHistory = NonNullable<
  DomainListAdminLoginHistoryResp['login_histories']
>[number];

const AdminLoginHistory = () => {
  const { data, loading } = useRequest(() =>
    getAdminLoginHistory({ page: 1, size: 50 })
  );
  const columns: ColumnsType<LoginHistory> = [
    {
      title: '账号',
      dataIndex: 'user',
      render: (user, record) => {
        return <User username={record!.user!.username!} />;
      },
    },
    {
      title: '源 IP 地址',
      dataIndex: 'ip',
      render: (ip, record) => {
        return (
          <Stack direction='column'>
            <Box>{record?.ip_info?.ip}</Box>
            <Box sx={{ color: 'text.secondary' }}>
              {record?.ip_info?.country === '中国'
                ? '' + record?.ip_info?.province + '-' + record?.ip_info?.city
                : record?.ip_info?.country || '未知'}
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '登录时间',
      dataIndex: 'created_at',
      render: (text) => {
        return (
          <Stack direction='column'>
            <Box>{dayjs.unix(text).format('YYYY-MM-DD')}</Box>
            <Box>{dayjs.unix(text).format('HH:mm:ss')}</Box>
          </Stack>
        );
      },
    },
  ];
  return (
    <Card sx={{ height: '100%' }}>
      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        sx={{
          mb: 2,
          height: 32,
          fontWeight: 'bold',
        }}
      >
        <Box
          sx={{
            '&::before': {
              content: '""',
              display: 'inline-block',
              width: 4,
              height: 12,
              bgcolor: 'common.black',
              borderRadius: '2px',
              mr: 1,
            },
          }}
        >
          管理员登录记录
        </Box>
      </Stack>
      <Table
        columns={columns}
        dataSource={data?.login_histories || []}
        pagination={false}
        rowKey='id'
        loading={loading}
        sx={{ mx: -2, maxHeight: '900px', overflow: 'auto' }}
      />
    </Card>
  );
};

export default AdminLoginHistory;
