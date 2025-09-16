import { Ellipsis, Icon, message, Modal, Table } from '@ctzhian/ui';
import { useEffect, useState } from 'react';

import Card from '@/components/card';
import { Box, Button, Stack } from '@mui/material';

import { deleteAiemployeeDelete, getAiemployeeList } from '@/api/AiEmployee';
import {
  deleteUserAiemployeeDelete,
  getUserAiemployeeList,
} from '@/api/UserAiEmployee';
import {
  ConstsRepoPlatform,
  DomainAIEmployee,
  DomainUpdateAIEmployeeReq,
} from '@/api/types';
import { ColumnsType } from '@ctzhian/ui/dist/Table';
import dayjs from 'dayjs';
import EmloyeeModal from './emloyeeModal';
import { useLocation } from 'react-router-dom';

const gitPlatformIcons = {
  [ConstsRepoPlatform.RepoPlatformGitHub]: 'icon-github',
  [ConstsRepoPlatform.RepoPlatformGitLab]: 'icon-gitlab',
  [ConstsRepoPlatform.RepoPlatformGitee]: 'icon-gitee',
  [ConstsRepoPlatform.RepoPlatformGitea]: 'icon-gitea',
} as const;
const EmployeeTaskList = () => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<DomainAIEmployee[]>([]);
  const [detail, setDetail] = useState<DomainUpdateAIEmployeeReq | undefined>();
  const { pathname } = useLocation();
  const isUser = pathname.startsWith('/user/');
  const [open, setOpen] = useState(false);
  const onClose = () => {
    setOpen(false);
    setDetail(undefined);
  };
  const onChanged = () => {
    onClose();
    fetchData({});
  };

  const fetchData = async (params: { page?: number; size?: number }) => {
    setLoading(true);
    const res = await (isUser ? getUserAiemployeeList : getAiemployeeList)({
      page: params.page || page,
      size: params.size || size,
    });
    setLoading(false);
    setTotal(res.total_count || 0);
    setDataSource(res.items || []);
  };

  useEffect(() => {
    setPage(1);
    fetchData({
      page: 1,
    });
  }, []);
  const handleEdit = (record: DomainAIEmployee) => {
    setOpen(true);
    setDetail({
      ...record,
      repo_url: record.repository_url,
      repo_user: record.repository_user,
    });
  };
  const handleDelete = (record: DomainAIEmployee) => {
    Modal.confirm({
      title: '提示',
      okText: '删除',
      okButtonProps: {
        color: 'error',
      },
      content: (
        <>
          确定要删除 AI 员工{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {record!.name}
          </Box>{' '}
          吗？
        </>
      ),
      onOk: () => {
        (isUser ? deleteUserAiemployeeDelete : deleteAiemployeeDelete)({
          id: record.id!,
        }).then(() => {
          message.success('删除成功');
          fetchData({});
        });
      },
    });
  };
  const columns: ColumnsType<DomainAIEmployee> = [
    {
      dataIndex: 'name',
      title: 'AI 员工',
      width: 240,
      render: (name, record) => {
        return (
          <Stack direction='column'>
            <Stack direction='row' alignItems='center' spacing={1}>
              <Icon
                type='icon-jiqiren'
                sx={{ fontSize: 20, color: 'text.main' }}
              />
              <Box
                sx={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {record?.name}
              </Box>
            </Stack>
            <Box
              sx={{
                color: 'text.tertiary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: '0.8rem',
                mt: '4px',
              }}
            >
              <Box
                sx={{
                  lineHeight: '16px',
                }}
              >
                {record?.position}
              </Box>
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '工作项目',
      dataIndex: 'platform',
      width: 300,
      render: (platform, record) => {
        return (
          <Stack direction='column'>
            <Stack direction='row' alignItems='center' spacing={1}>
              <Icon
                type={gitPlatformIcons[record.platform as ConstsRepoPlatform]}
                sx={{ fontSize: 16, color: 'text.main' }}
              />
              <Box
                sx={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {record?.repository_url
                  ? record?.repository_url.split('/').pop()
                  : record?.platform}
              </Box>
            </Stack>
            <Ellipsis
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: '0.8rem',
              }}
            >
              {record?.repository_url}
            </Ellipsis>
          </Stack>
        );
      },
    },
    {
      title: '创建者',
      dataIndex: 'creater',
      render: (creater, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.admin?.username}
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: '0.8rem',
              }}
            >
              {dayjs(Number(record?.created_at) * 1000).fromNow()}创建
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '工作状态',
      dataIndex: 'status',
      render: (status, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              共完成 {record?.completed_count || 0} 个任务
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: '0.8rem',
              }}
            >
              {dayjs(Number(record?.last_active_at) * 1000).fromNow()}活跃
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '操作',
      dataIndex: 'opt',
      render: (status, record) => {
        return (
          <Stack direction='row' spacing={1}>
            <Button variant='text' onClick={() => handleEdit(record)}>
              修改
            </Button>
            <Button
              variant='text'
              color='error'
              onClick={() => handleDelete(record)}
            >
              删除
            </Button>
          </Stack>
        );
      },
    },
  ];
  return (
    <Card sx={{ flex: 1, height: '100%' }}>
      <Stack height='100%'>
        <Button
          variant='contained'
          size='small'
          sx={{ mb: 2, alignSelf: 'flex-end' }}
          onClick={() => setOpen(true)}
        >
          创建 AI 员工
        </Button>
        <Table
          sx={{ mx: -2, flexGrow: 1, overflow: 'auto' }}
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
        <EmloyeeModal
          open={open}
          record={detail}
          onClose={onClose}
          onChanged={onChanged}
        />
      </Stack>
    </Card>
  );
};

export default EmployeeTaskList;
