import React, { useState, useEffect } from 'react';
import { Table } from '@c-x/ui';
import { getListChatRecord } from '@/api/Billing';
import dayjs from 'dayjs';

import Card from '@/components/card';
import { Box } from '@mui/material';
import StyledLabel from '@/components/label';

import ChatDetailModal from './chatDetailModal';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { DomainChatRecord, DomainUser } from '@/api/types';
import { addCommasToNumber } from '@/utils';
import User from '@/components/user';

const Chat = () => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<DomainChatRecord[]>([]);
  const [chatDetailModal, setChatDetailModal] = useState<
    DomainChatRecord | undefined
  >();
  const fetchData = async () => {
    setLoading(true);
    const res = await getListChatRecord({
      page: page,
      size: size,
    });
    setLoading(false);
    setTotal(res?.total_count || 0);
    setDataSource(res.records || []);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line
  }, [page, size]);

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
        return (
          <StyledLabel color={value ? workModeMap[value]['color'] : 'default'}>
            {value ? workModeMap[value]['name'] : '未知'}
          </StyledLabel>
        );
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
      <Table
        height='100%'
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
