import React, { useEffect, useState } from 'react';
import Card from '@/components/card';
import { useNavigate } from 'react-router-dom';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useRequest } from 'ahooks';
import { deleteDeleteUser, getListUser, putUpdateUser } from '@/api/User';
import {
  Stack,
  Box,
  Button,
  TextField,
  Chip,
  Paper,
  Link,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { Table, MenuSelect, Modal, message } from '@c-x/ui';
import InviteUserModal from './inviteUserModal';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { ConstsUserStatus, DomainUser } from '@/api/types';
import dayjs from 'dayjs';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import User from '@/components/user';

const ResetPasswordModal = ({
  open,
  onCancel,
  user,
}: {
  open: boolean;
  onCancel: () => void;
  user: DomainUser;
}) => {
  const [isSuccess, setIsSuccess] = useState(false);
  const [password, setPassword] = useState('');

  const onResetPassword = () => {
    putUpdateUser({
      id: user.id!,
      password: password,
    }).then(() => {
      message.success('重置密码成功');
      setIsSuccess(true);
    });
  };

  useEffect(() => {
    if (open) {
      setIsSuccess(false);
      setPassword(Math.random().toString(36).substring(2, 15));
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={
        isSuccess ? (
          '密码重置成功'
        ) : (
          <Stack direction='row' gap={2}>
            <ErrorRoundedIcon color='warning' />
            提示
          </Stack>
        )
      }
      footer={false}
    >
      {!isSuccess && (
        <Stack gap={2}>
          <Box
            sx={{
              color: 'text.primary',
              pl: 5,
            }}
          >
            确认重置密码吗？
          </Box>
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
              color='error'
              onClick={onResetPassword}
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
            密码重置成功，请将账号和密码复制到剪贴板
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
              <Box>账号：{user.username}</Box>
              <Box>密码：{password}</Box>
            </Box>
          </Paper>
          <CopyToClipboard
            text={`账号：${user.username}\n密码：${password}`}
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

const MemberManage = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<DomainUser | null>(null);
  const { data, loading, refresh } = useRequest(() => getListUser({}));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    record: DomainUser
  ) => {
    setAnchorEl(event.currentTarget);
    setCurrentUser(record);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const onDeleteUser = () => {
    handleClose();
    Modal.confirm({
      title: '提示',
      okText: '删除',
      okButtonProps: {
        color: 'error',
      },
      content: (
        <>
          确定要删除该用户{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {currentUser!.username}
          </Box>{' '}
          吗？
        </>
      ),
      onOk: () => {
        deleteDeleteUser({ id: currentUser!.id! }).then(() => {
          message.success('删除成功');
          refresh();
        });
      },
    });
  };

  const onUnLockUser = () => {
    handleClose();
    Modal.confirm({
      title: '提示',
      okText: '解锁',
      content: (
        <>
          确定要解锁该用户{' '}
          <Box component='span' sx={{ fontWeight: 700 }}>
            {currentUser!.username}
          </Box>{' '}
          吗？
        </>
      ),
      onOk: () => {
        putUpdateUser({
          id: currentUser!.id!,
          status: ConstsUserStatus.UserStatusActive,
        }).then(() => {
          message.success('解锁成功');
          refresh();
        });
      },
    });
  };

  const onLockUser = () => {
    handleClose();
    Modal.confirm({
      title: '提示',
      okText: '锁定',
      okButtonProps: {
        color: 'error',
      },
      content: (
        <>
          确定要锁定该用户{' '}
          <Box component='span' sx={{ fontWeight: 700 }}>
            {currentUser!.username}
          </Box>{' '}
          吗？
        </>
      ),
      onOk: () => {
        putUpdateUser({
          id: currentUser!.id!,
          status: ConstsUserStatus.UserStatusLocked,
        }).then(() => {
          message.success('锁定成功');
          refresh();
        });
      },
    });
  };

  const columns: ColumnsType<DomainUser> = [
    {
      title: '账号',
      dataIndex: 'username',
      render: (text, record) => {
        return (
          <User
            id={record.id!}
            username={record.username!}
            email={record.email!}
          />
        );
      },
    },
    {
      title: '加入时间',
      dataIndex: 'created_at',
      width: 120,
      render: (text) => {
        return dayjs.unix(text).fromNow();
      },
    },
    {
      title: '最近活跃',
      dataIndex: 'last_active_at',
      width: 120,
      render: (text, record) => {
        return record.last_active_at === 0
          ? '从未使用'
          : dayjs.unix(text).fromNow();
      },
    },
    {
      title: '',
      dataIndex: 'action',
      width: 100,
      render: (_, record) => {
        return (
          <IconButton
            onClick={(e) => handleClick(e, record)}
            sx={{
              '&:hover': {
                color: 'info.main',
              },
            }}
          >
            <MoreHorizIcon />
          </IconButton>
        );
      },
    },
  ];
  return (
    <Card sx={{ flex: 1, height: '100%' }}>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose}>
        {currentUser?.status === ConstsUserStatus.UserStatusActive && (
          <MenuItem onClick={onLockUser}>解锁成员</MenuItem>
        )}
        {currentUser?.status === ConstsUserStatus.UserStatusLocked && (
          <MenuItem onClick={onUnLockUser}>解锁成员</MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setCurrentUser(null);
            setResetPasswordOpen(true);
          }}
        >
          重置密码
        </MenuItem>

        <MenuItem sx={{ color: 'error.main' }} onClick={onDeleteUser}>
          删除成员
        </MenuItem>
      </Menu>

      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        sx={{ mb: 2 }}
      >
        <Box sx={{ fontWeight: 700 }}>成员列表</Box>
        <Stack direction='row' gap={1}>
          <TextField label='搜索' size='small' />
          <Button
            variant='contained'
            color='primary'
            onClick={() => setOpen(true)}
          >
            邀请新用户
          </Button>
        </Stack>
      </Stack>
      <Table
        columns={columns}
        height='calc(100% - 53px)'
        dataSource={data?.users || []}
        sx={{ mx: -2 }}
        pagination={false}
        rowKey='id'
        loading={loading}
      />
      <InviteUserModal open={open} onClose={() => setOpen(false)} />
      <ResetPasswordModal
        open={resetPasswordOpen}
        onCancel={() => setResetPasswordOpen(false)}
        user={currentUser!}
      />
    </Card>
  );
};

export default MemberManage;
