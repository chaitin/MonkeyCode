import Card from '@/components/card';
import { Stack, Box } from '@mui/material';
import { useRequest } from 'ahooks';
import { getLoginHistory } from '@/api/User';
import { Table } from '@ctzhian/ui';
import dayjs from 'dayjs';
import { ColumnsType } from '@ctzhian/ui/dist/Table';
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
          <Box
            sx={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <User
              username={record.user!.username!}
              id={record.user!.id!}
              email={record.user!.email!}
              avatar={record.user!.avatar_url!}
              deleted={record.user!.is_deleted!}
            />
          </Box>
        );
      },
    },
    {
      title: '设备',
      dataIndex: 'device',
      render: (ip, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.device}
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.hostname}
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '客户端',
      dataIndex: 'client',
      render: (ip, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.client_id}
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.client_version}
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '源 IP 地址',
      dataIndex: 'ip',
      render: (ip, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.ip_info?.ip}
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
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
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {dayjs.unix(text).format('YYYY-MM-DD')}
            </Box>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {dayjs.unix(text).format('HH:mm:ss')}
            </Box>
          </Stack>
        );
      },
    },
  ];
  return (
    <Card sx={{ flex: 1, height: '500px' }}>
      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        sx={{ mb: 2 }}
      >
        <Box sx={{ fontWeight: 700 }}>成员登录记录</Box>
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
