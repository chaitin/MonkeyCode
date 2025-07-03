import React, { useState, useEffect } from 'react';
import { Table, Ellipsis } from '@c-x/ui';
import { getListChatRecord } from '@/api/Billing';
import { aggregatedTime } from '@/utils';
import dayjs from 'dayjs';
import { convertTokensToRMB } from '@/utils';

import Card from '@/components/card';
import { Box, Stack, styled, Chip } from '@mui/material';
import StyledLabel from '@/components/label';

import ChatDetailModal from './chatDetailModal';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { DomainChatRecord } from '@/api/types';
import { addCommasToNumber } from '@/utils';

const StyledHighlightText = styled('span')(({ theme }) => ({
  color: theme.vars.palette.text.primary,
  fontWeight: 700,
}));

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
  }, [page, size]);

  const columns: ColumnsType<DomainChatRecord> = [
    {
      dataIndex: 'user',
      title: '成员',
      width: 160,
      render(value: DomainChatRecord['user']) {
        return value?.username;
      },
    },
    {
      dataIndex: 'question',
      title: '任务',
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
            {cleanValue}
          </Box>
        );
      },
    },
    {
      dataIndex: 'work_mode',
      title: '工作模式',
      width: 120,
      render(value: DomainChatRecord['work_mode']) {
        const workModeMap: Record<string, string> = {
          code: 'warning',
          ask: 'info',
          architect: 'success',
          debugger: 'error',
          orchestrator: 'info',
        };
        return (
          <StyledLabel color={value ? workModeMap[value] : 'default'}>
            {value}
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
        height='calc(100%)'
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
