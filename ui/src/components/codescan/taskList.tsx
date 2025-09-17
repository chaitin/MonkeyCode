import { useState, useEffect } from 'react';
import { Table } from '@ctzhian/ui';
import { getSecurityScanningList } from '@/api/SecurityScanning';
import dayjs from 'dayjs';

import Card from '@/components/card';
import { Autocomplete, Box, Stack, TextField, Tooltip } from '@mui/material';

import { ColumnsType } from '@ctzhian/ui/dist/Table';
import {
  DomainSecurityScanningResult,
  DomainSecurityScanningRiskResult,
  DomainUser,
} from '@/api/types';
import User from '@/components/user';
import TaskDetail from './taskDetail';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { getUserSecurityScanningList } from '@/api';

const CodeScanTaskList = ({
  admin,
  users,
}: {
  admin: boolean;
  users: DomainUser[];
}) => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<DomainSecurityScanningResult[]>(
    []
  );
  const [detail, setDetail] = useState<
    DomainSecurityScanningResult | undefined
  >();
  const [filterUser, setFilterUser] = useState('');

  const fetchData = async (params: {
    page?: number;
    size?: number;
    work_mode?: string;
    author?: string;
  }) => {
    setLoading(true);
    const res = await (admin
      ? getSecurityScanningList
      : getUserSecurityScanningList)({
      page: params.page || page,
      size: params.size || size,
      author: params.author || filterUser,
    });
    setLoading(false);
    setTotal(res.total_count || 0);
    setDataSource(res.items || []);
  };

  useEffect(() => {
    setPage(1);
    fetchData({
      page: 1,
      author: filterUser,
    });
  }, [filterUser]);

  const columns: ColumnsType<DomainSecurityScanningResult> = [
    {
      dataIndex: 'name',
      title: '扫描任务',
      width: 240,
      render: (project_name, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.name}
            </Box>
            <Box
              sx={{
                color: 'text.tertiary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                mt: '4px',
              }}
            >
              {record.status === 'pending' && (
                <Stack direction={'row'}>
                  <AutoModeIcon
                    sx={{
                      width: '16px',
                      height: '16px',
                      color: 'info.main',
                    }}
                  />
                  <Box
                    sx={{
                      lineHeight: '16px',
                      ml: '4px',
                    }}
                  >
                    等待扫描
                  </Box>
                </Stack>
              )}
              {record.status === 'running' && (
                <Stack direction={'row'}>
                  <AutoModeIcon
                    sx={{
                      width: '16px',
                      height: '16px',
                      color: 'info.main',
                      animation: 'spin 1s linear infinite',
                      '@keyframes spin': {
                        '0%': {
                          transform: 'rotate(0deg)',
                        },
                        '100%': {
                          transform: 'rotate(360deg)',
                        },
                      },
                    }}
                  />
                  <Box
                    sx={{
                      lineHeight: '16px',
                      ml: '4px',
                    }}
                  >
                    正在扫描
                  </Box>
                </Stack>
              )}
              {record.status === 'success' && (
                <Stack direction={'row'}>
                  <CheckCircleOutlineIcon
                    sx={{
                      width: '16px',
                      height: '16px',
                      color: 'success.main',
                    }}
                  />
                  <Box
                    sx={{
                      lineHeight: '16px',
                      ml: '4px',
                    }}
                  >
                    扫描完成
                  </Box>
                </Stack>
              )}
              {record.status === 'failed' && (
                <Tooltip title={record.error}>
                  <Stack direction={'row'}>
                    <ErrorOutlineIcon
                      sx={{
                        width: '16px',
                        height: '16px',
                        color: 'error.main',
                      }}
                    />
                    <Box
                      sx={{
                        lineHeight: '16px',
                        ml: '4px',
                      }}
                    >
                      扫描失败
                    </Box>
                  </Stack>
                </Tooltip>
              )}
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '项目名称',
      dataIndex: 'project_name',
      render: (project_name, record) => {
        return (
          <Stack direction='column'>
            <Box
              sx={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.project_name}
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record?.path}
            </Box>
          </Stack>
        );
      },
    },
    {
      dataIndex: 'risk',
      title: '扫描结果',
      width: 260,
      render(risk: DomainSecurityScanningRiskResult, record) {
        const hasNoRisk =
          record.status !== 'pending' &&
          (!risk.severe_count || risk.severe_count <= 0) &&
          (!risk.critical_count || risk.critical_count <= 0) &&
          (!risk.suggest_count || risk.suggest_count <= 0);

        const tip = [];
        if (risk.severe_count && risk.severe_count > 0) {
          tip.push(`严重安全告警 ${risk.severe_count} 个`);
        }
        if (risk.critical_count && risk.critical_count > 0) {
          tip.push(`高风险安全提醒 ${risk.critical_count} 个`);
        }
        if (risk.suggest_count && risk.suggest_count > 0) {
          tip.push(`低风险安全提醒 ${risk.suggest_count} 个`);
        }

        return (
          <Tooltip title={hasNoRisk ? '暂无风险' : tip.join(', ')}>
            <Stack
              direction='row'
              onClick={() => {
                if (!hasNoRisk) {
                  setDetail(record);
                }
              }}
              sx={{
                color: '#fff',
                fontSize: '12px',
                width: '200px',
                height: '24px',
                lineHeight: '24px',
                background:
                  record.status === 'pending' || record.status === 'running'
                    ? 'repeating-linear-gradient(45deg, #f0f0f0, #f0f0f0 10px, #e0e0e0 10px, #e0e0e0 20px)'
                    : '#F1F2F8',
                backgroundSize: '30px 30px',
                animation: 'stripes 1s linear infinite',
                borderRadius: '4px',
                overflow: 'hidden',
                transition: 'box-shadow 0.3s ease',
                userSelect: 'none',
                '&:hover': {
                  cursor: 'pointer',
                  boxShadow: hasNoRisk ? '' : '0 0px 8px #FFCF62',
                },
                '@keyframes stripes': {
                  '0%': {
                    backgroundPosition: '0 0',
                  },
                  '100%': {
                    backgroundPosition: '30px 0',
                  },
                },
              }}
            >
              {(record.status === 'success' || record.status === 'failed') &&
              hasNoRisk ? (
                // 如果没有风险，显示"无风险"
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    color: 'disabled.main',
                  }}
                >
                  暂无风险
                </Box>
              ) : (
                // 否则，显示原有的风险条
                <>
                  {!!risk.severe_count && risk.severe_count > 0 && (
                    <Box
                      sx={{
                        backgroundColor: 'risk.severe',
                        minWidth: '30px',
                        width:
                          ((risk.severe_count || 0) * 100) /
                            ((risk.critical_count || 0) +
                              (risk.severe_count || 0) +
                              (risk.suggest_count || 0)) +
                          '%',
                        textAlign: 'center',
                      }}
                    >
                      {risk.severe_count}
                    </Box>
                  )}
                  {!!risk.critical_count && risk.critical_count > 0 && (
                    <Box
                      sx={{
                        backgroundColor: 'risk.critical',
                        minWidth: '30px',
                        width:
                          ((risk.critical_count || 0) * 100) /
                            ((risk.critical_count || 0) +
                              (risk.severe_count || 0) +
                              (risk.suggest_count || 0)) +
                          '%',
                        textAlign: 'center',
                      }}
                    >
                      {risk.critical_count}
                    </Box>
                  )}
                  {!!risk.suggest_count && risk.suggest_count > 0 && (
                    <Box
                      sx={{
                        backgroundColor: 'risk.suggest',
                        minWidth: '30px',
                        width:
                          ((risk.suggest_count || 0) * 100) /
                            ((risk.critical_count || 0) +
                              (risk.severe_count || 0) +
                              (risk.suggest_count || 0)) +
                          '%',
                        textAlign: 'center',
                      }}
                    >
                      {risk.suggest_count}
                    </Box>
                  )}
                </>
              )}
            </Stack>
          </Tooltip>
        );
      },
    },
    {
      dataIndex: 'user',
      title: '成员',
      width: 200,
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
      title: '扫描时间',
      dataIndex: 'created_at',
      width: 160,
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
    <Card sx={{ flex: 1, height: '100%' }}>
      {admin && (
        <Stack direction='row' spacing={2} sx={{ mb: 2 }}>
          <Autocomplete
            size='small'
            sx={{ minWidth: 220 }}
            options={users || []}
            getOptionLabel={(option) => option.username || ''}
            value={users?.find((item) => item.username === filterUser) || null}
            onChange={(_, newValue) =>
              setFilterUser(newValue ? newValue.username! : '')
            }
            isOptionEqualToValue={(option, value) =>
              option.username === value.username
            }
            renderInput={(params) => <TextField {...params} label='成员' />}
            clearOnEscape
          />
        </Stack>
      )}
      <Table
        height={admin ? 'calc(100% - 52px)' : '100%'}
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
      <TaskDetail
        open={!!detail}
        onClose={() => setDetail(undefined)}
        task={detail}
        admin={admin}
      />
    </Card>
  );
};

export default CodeScanTaskList;
