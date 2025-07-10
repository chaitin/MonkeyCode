import Card from '@/components/card';
import { Stack, Box } from '@mui/material';
import { useRequest } from 'ahooks';
import { getLoginHistory } from '@/api/User';
import { Table } from '@c-x/ui';
import dayjs from 'dayjs';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { DomainListLoginHistoryResp } from '@/api/types';
import User from '@/components/user';

type LoginHistory = NonNullable<
  DomainListLoginHistoryResp['login_histories']
>[number];

const LoginHistory = () => {
  const { data, loading } = useRequest(() => getLoginHistory({}));
  const columns: ColumnsType<LoginHistory> = [
    {
      title: '账号',
      dataIndex: 'user',
      render: (user, record) => {
        return (
          <User
            username={record.user!.username!}
            id={record.user!.id!}
            email={record.user!.email!}
          />
        );
      },
    },
    {
      title: '设备',
      dataIndex: 'device',
    },
    {
      title: '客户端版本',
      dataIndex: 'client_version',
    },
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      render: (ip, record) => {
        let address = '';
        if (record?.ip_info) {
          address = `${record?.ip_info?.country}-${record?.ip_info?.city}`;
        }
        return (
          <Stack direction='row'>
            <Box>{ip}</Box>
            <Box sx={{ color: 'text.secondary' }}>（{address}）</Box>
          </Stack>
        );
      },
    },
    {
      title: '登录时间',
      dataIndex: 'created_at',
      render: (text) => {
        return dayjs.unix(text).format('YYYY-MM-DD HH:mm:ss');
      },
    },
  ];
  return (
    <Card sx={{ flex: 1, height: 'calc(100% - 258px)' }}>
      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        sx={{ mb: 2 }}
      >
        <Box sx={{ fontWeight: 700 }}>登录历史</Box>
      </Stack>
      <Table
        height='calc(100% - 40px)'
        columns={columns}
        dataSource={data?.login_histories || []}
        pagination={false}
        rowKey='id'
        loading={loading}
        sx={{ mx: -2 }}
      />
    </Card>
  );
};

export default LoginHistory;
