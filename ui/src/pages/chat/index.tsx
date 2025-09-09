import React, { useState, useEffect } from 'react';
import { Table } from '@c-x/ui';
import { getListChatRecord } from '@/api/Billing';
import dayjs from 'dayjs';

import Card from '@/components/card';
import {
  Autocomplete,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import StyledLabel from '@/components/label';

import ChatDetailModal from './chatDetailModal';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { DomainChatRecord, DomainUser } from '@/api/types';
import { addCommasToNumber } from '@/utils';
import User from '@/components/user';
import { useRequest } from 'ahooks';
import { getListUser } from '@/api/User';

const Chat = () => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<DomainChatRecord[]>([]);
  const [chatDetailModal, setChatDetailModal] = useState<
    DomainChatRecord | undefined
  >();
  const [filterUser, setFilterUser] = useState('');
  const [filterMode, setfilterMode] = useState<
    'code' | 'architect' | 'ask' | 'debug' | 'orchestrator'
  >();

  const { data: userOptions = { users: [] } } = useRequest(() =>
    getListUser({
      page: 1,
      size: 9999,
    })
  );

  const fetchData = async (params: {
    page?: number;
    size?: number;
    work_mode?: string;
    author?: string;
  }) => {
    setLoading(true);
    const res = await getListChatRecord({
      page: params.page || page,
      size: params.size || size,
      work_mode: params.work_mode || filterMode,
      author: params.author || filterUser,
    });
    setLoading(false);
    setTotal(res?.total_count || 0);
    setDataSource(res.records || []);
  };

  useEffect(() => {
    setPage(1); // 筛选变化时重置页码
    fetchData({
      page: 1,
      work_mode: filterMode,
      author: filterUser,
    });
  }, [filterMode, filterUser]);

  const columns: ColumnsType<DomainChatRecord> = [
    {
      dataIndex: 'user',
      title: '成员',
      width: 260,
      render(value: DomainUser) {
        return (
          <User
            id={value.id!}
            username={value.username!}
            email={value.email!}
            avatar={value.avatar_url!}
            deleted={value.is_deleted!}
          />
        );
      },
    },
    {
      dataIndex: 'question',
      title: '任务内容',
      render(value: string, record) {
        const cleanValue = value?.replace(/<\/?task>/g, '') || value;
        return (
          <Box
            onClick={() => setChatDetailModal(record)}
            sx={{
              cursor: 'pointer',
              color: 'info.main',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {cleanValue || '无标题任务'}
          </Box>
        );
      },
    },
    {
      dataIndex: 'work_mode',
      title: '工作模式',
      width: 120,
      render(value: DomainChatRecord['work_mode']) {
        const workModeMap: Record<string, Record<string, string>> = {
          code: {
            name: '编程模式',
            color: 'warning',
          },
          ask: {
            name: '问答模式',
            color: 'info',
          },
          architect: {
            name: '架构模式',
            color: 'success',
          },
          debug: {
            name: '调试模式',
            color: 'error',
          },
          orchestrator: {
            name: '编排模式',
            color: 'info',
          },
        };

        const current = workModeMap[value!] || {
          color: 'default',
          name: '未知',
        };

        return <StyledLabel color={current.color}>{current.name}</StyledLabel>;
      },
    },
    {
      dataIndex: 'input_tokens',
      title: '输入 Token',
      width: 150,
      render(value: number) {
        return addCommasToNumber(value);
      },
    },
    {
      dataIndex: 'output_tokens',
      title: '输出 Token',
      width: 150,
      render(value: number) {
        return addCommasToNumber(value);
      },
    },
    {
      dataIndex: 'created_at',
      title: '时间',
      width: 180,
      render(value: number) {
        return dayjs.unix(value).format('YYYY-MM-DD HH:mm:ss');
      },
    },
  ];
  return (
    <Card sx={{ flex: 1, height: '100%' }}>
      <Stack direction='row' spacing={2} sx={{ mb: 2 }}>
        <Autocomplete
          size='small'
          sx={{ minWidth: 220 }}
          options={userOptions.users || []}
          getOptionLabel={(option) => option.username || ''}
          value={
            userOptions.users?.find((item) => item.username === filterUser) ||
            null
          }
          onChange={(_, newValue) =>
            setFilterUser(newValue ? newValue.username! : '')
          }
          isOptionEqualToValue={(option, value) =>
            option.username === value.username
          }
          renderInput={(params) => <TextField {...params} label='成员' />}
          clearOnEscape
        />
        <FormControl size='small' sx={{ minWidth: 180 }}>
          <InputLabel>工作模式</InputLabel>
          <Select
            label='工作模式'
            value={filterMode}
            onChange={(e) =>
              setfilterMode(
                e.target.value as
                  | 'code'
                  | 'ask'
                  | 'architect'
                  | 'debug'
                  | 'orchestrator'
              )
            }
          >
            <MenuItem value=''>全部</MenuItem>
            <MenuItem value='code'>编程模式</MenuItem>
            <MenuItem value='ask'>问答模式</MenuItem>
            <MenuItem value='architect'>架构模式</MenuItem>
            <MenuItem value='debug'>调试模式</MenuItem>
            <MenuItem value='orchestrator'>编排模式</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      <Table
        height='calc(100% - 52px)'
        sx={{ mx: -2 }}
        PaginationProps={{
          sx: {
            pt: 2,
            mx: 2,
          },
        }}
        loading={loading}
        columns={columns}
        dataSource={dataSource}
        rowKey='id'
        pagination={{
          page,
          pageSize: size,
          total,
          onChange: (page: number, size: number) => {
            setPage(page);
            setSize(size);
            fetchData({
              page: page,
              size: size,
            });
          },
        }}
      />
      <ChatDetailModal
        open={!!chatDetailModal}
        onClose={() => setChatDetailModal(undefined)}
        data={chatDetailModal}
      />
    </Card>
  );
};

export default Chat;
