import Card from '@/components/card';
import {
  Stack,
  Box,
  Button,
  IconButton,
  TextField,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import { AdminPanelSettings, Person } from '@mui/icons-material';
import { postCreateAdmin } from '@/api/Admin';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import {
  deleteDeleteAdmin,
  getAdminProfile,
  getListAdminUser,
  postGrantRole,
} from '@/api/Admin';
import { Table, Modal, message } from '@ctzhian/ui';
import { ColumnsType } from '@ctzhian/ui/dist/Table';
import { useRequest } from 'ahooks';
import dayjs from 'dayjs';
import { DomainAdminUser } from '@/api/types';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import User from '@/components/user';

const AddAdminModal = ({
  open,
  onCancel,
  onOk,
}: {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
}) => {
  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm();

  const username = watch('username');
  const [password, setPassword] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const onSubmit = handleSubmit((data) => {
    postCreateAdmin({
      username: data.username,
      password,
      role_id: data.roleId, // 添加 role_id 参数
    }).then(() => {
      setIsSuccess(true);
      message.success('添加成功');
      onOk();
    });
  });

  useEffect(() => {
    if (open) {
      reset({
        roleId: 2, // 设置默认角色为普通管理员
      });
    } else {
      setIsSuccess(false);
      setPassword(Math.random().toString(36).substring(2, 15));
    }
  }, [open]);

  return (
    <Modal
      title='添加管理员'
      open={open}
      onCancel={onCancel}
      onOk={onSubmit}
      footer={false}
    >
      {!isSuccess && (
        <Stack gap={2}>
          <Controller
            control={control}
            name='username'
            rules={{ required: '请输入账号' }}
            render={({ field }) => (
              <TextField
                fullWidth
                required
                label='账号'
                {...field}
                error={!!errors.username}
                helperText={errors.username?.message as string}
              />
            )}
          />
          <Controller
            control={control}
            name='roleId'
            rules={{ required: '请选择角色' }}
            render={({ field }) => (
              <FormControl fullWidth required error={!!errors.roleId}>
                <InputLabel>角色</InputLabel>
                <Select
                  label='角色'
                  {...field}
                  value={field.value || ''} // 确保有默认值
                >
                  <MenuItem value={1}>超级管理员</MenuItem>
                  <MenuItem value={2}>普通管理员</MenuItem>
                </Select>
                {errors.roleId && (
                  <Box
                    sx={{ color: 'error.main', fontSize: '0.75rem', mt: 0.5 }}
                  >
                    {errors.roleId?.message as string}
                  </Box>
                )}
              </FormControl>
            )}
          />
          <Stack
            direction='row'
            justifyContent='flex-end'
            gap={2}
            sx={{ mt: 2 }}
          >
            <Button variant='text' color='primary' onClick={onCancel}>
              取消
            </Button>
            <Button
              variant='contained'
              color='primary'
              onClick={onSubmit}
              disabled={isSuccess}
            >
              确认
            </Button>
          </Stack>
        </Stack>
      )}

      {isSuccess && (
        <Stack gap={2}>
          <Box sx={{ fontSize: 14, color: 'text.secondary' }}>
            账号添加成功，请将账号和密码复制到剪贴板
          </Box>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              bgcolor: 'grey.50',
              borderRadius: 1,
            }}
          >
            <Box
              sx={{
                color: 'primary.main',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}
            >
              <Box>账号：{username}</Box>
              <Box>密码：{password}</Box>
            </Box>
          </Paper>
          <CopyToClipboard
            text={`账号：${username}\n密码：${password}`}
            onCopy={() => {
              message.success('复制成功');
              onCancel();
            }}
          >
            <Button
              variant='contained'
              color='primary'
              sx={{ alignSelf: 'flex-end' }}
            >
              复制并关闭
            </Button>
          </CopyToClipboard>
        </Stack>
      )}
    </Modal>
  );
};

const AdminUser = () => {
  const [open, setOpen] = useState(false);
  const { data, loading, refresh } = useRequest(() => getListAdminUser({}));
  const { data: currentAdmin } = useRequest(() => getAdminProfile({}));

  const handleRoleChange = (adminId: string, newRoleId: number) => {
    postGrantRole({
      admin_id: adminId,
      role_ids: [newRoleId],
    })
      .then(() => {
        message.success('角色更新成功');
        refresh();
      })
      .catch(() => {
        message.error('角色更新失败');
      });
  };

  const onDeleteAdmin = (data: DomainAdminUser) => {
    Modal.confirm({
      title: '提示',
      okText: '删除',
      okButtonProps: {
        color: 'error',
      },
      content: (
        <>
          确定要删除该管理员{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.username}
          </Box>{' '}
          吗？
        </>
      ),
      onOk: () => {
        deleteDeleteAdmin({ id: data.id! }).then(() => {
          message.success('删除成功');
          refresh();
        });
      },
    });
  };
  const columns: ColumnsType<DomainAdminUser> = [
    {
      title: '账号',
      dataIndex: 'username',
      render: (text) => {
        return <User username={text} />;
      },
    },
    {
      title: '角色',
      dataIndex: 'last_active_at',
      render: (text, record) => {
        return (
          <FormControl fullWidth>
            <Select
              size='small'
              value={record.role?.id || ''}
              onChange={(e) =>
                handleRoleChange(record.id!, Number(e.target.value))
              }
              displayEmpty
              disabled={record.id === currentAdmin?.id}
              renderValue={(value) => {
                if (value === 1) {
                  return (
                    <Stack direction='row' alignItems='center' gap={1}>
                      <AdminPanelSettings fontSize='small' />
                      <span>超级管理员</span>
                    </Stack>
                  );
                } else if (value === 2) {
                  return (
                    <Stack direction='row' alignItems='center' gap={1}>
                      <Person fontSize='small' />
                      <span>普通管理员</span>
                    </Stack>
                  );
                }
                return '请选择角色';
              }}
              sx={{
                mr: 1,
              }}
            >
              <MenuItem value={1}>
                <Stack direction='row' alignItems='center' gap={1}>
                  <AdminPanelSettings fontSize='small' />
                  <span>超级管理员</span>
                </Stack>
              </MenuItem>
              <MenuItem value={2}>
                <Stack direction='row' alignItems='center' gap={1}>
                  <Person fontSize='small' />
                  <span>普通管理员</span>
                </Stack>
              </MenuItem>
            </Select>
          </FormControl>
        );
      },
    },
    {
      title: '活跃时间',
      dataIndex: 'created_at',
      width: 120,
      render: (text, record) => {
        return (
          <Stack>
            <Box>{dayjs.unix(text).fromNow()}</Box>
            <Box>
              {record.last_active_at === 0
                ? '从未使用'
                : dayjs.unix(text).fromNow()}
            </Box>
          </Stack>
        );
      },
    },
    {
      title: '',
      dataIndex: 'opt',
      width: 100,
      render: (_, record) => {
        return (
          <Button
            variant='text'
            color='error'
            size='small'
            onClick={() => onDeleteAdmin(record)}
          >
            删除
          </Button>
        );
      },
    },
  ];
  return (
    <Card>
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
          管理员清单
        </Box>
        <Button
          variant='contained'
          color='primary'
          onClick={() => setOpen(true)}
        >
          添加管理员
        </Button>
      </Stack>
      <Table<DomainAdminUser>
        // height='calc(100% - 50px)'
        columns={columns}
        loading={loading}
        dataSource={data?.users || []}
        pagination={false}
        rowKey='id'
        sx={{ mx: -2 }}
      />
      <AddAdminModal
        open={open}
        onOk={refresh}
        onCancel={() => setOpen(false)}
      />
    </Card>
  );
};

export default AdminUser;
