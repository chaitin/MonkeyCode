import React, { useState, useMemo, useRef } from 'react';
import Card from '@/components/card';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useRequest } from 'ahooks';
import { getListUser } from '@/api/User';
import {
  Stack,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Chip,
  SelectChangeEvent,
  TextField,
} from '@mui/material';
import { Table, Modal, message } from '@ctzhian/ui';
import { ColumnsType } from '@ctzhian/ui/dist/Table';
import {
  DomainAdminUser,
  DomainLicenseEdition,
  DomainUser,
  DomainUserGroup,
} from '@/api/types';
import {
  deleteDeleteGroup,
  getListAdminUser,
  getListUserGroup,
  v1LicenseList,
} from '@/api';
import {
  deleteRemoveAdminFromGroup,
  postGrantGroup,
  postAddUserToGroup,
  deleteRemoveUserFromGroup,
  putUpdateUserGroup,
} from '@/api/UserGroup';
import CreateGroupModal from './createGroupModal';
import UpdateGroupModal from './updateGroupModal';
import { Check } from '@mui/icons-material';

const GroupList = () => {
  const [openCreateGroupModal, setOpenCreateGroupModal] = useState(false);
  const [openUpdateGroupModal, setOpenUpdateGroupModal] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<DomainUserGroup | null>(
    null
  );
  const groupData = useRequest(() => getListUserGroup({ page: 1, size: 9999 }));
  const userData = useRequest(() => getListUser({ page: 1, size: 9999 }));
  const adminData = useRequest(() => getListAdminUser({ page: 1, size: 9999 }));
  const [searchUser, setSearchUser] = useState('');
  const [memberSearchText, setMemberSearchText] = useState('');
  const [adminSearchText, setAdminSearchText] = useState('');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const memberInputRef = useRef<HTMLInputElement>(null);
  const adminInputRef = useRef<HTMLInputElement>(null);
  const license = useRequest(() => {
    return v1LicenseList({});
  }).data;

  const filteredData = useMemo(() => {
    if (!groupData?.data?.groups) return [];
    if (searchUser) {
      return groupData.data.groups.filter((item) =>
        (item.name || '').toLowerCase().includes(searchUser.toLowerCase())
      );
    }
    return groupData.data.groups;
  }, [searchUser, groupData?.data?.groups]);

  const filteredSelectUsers = useMemo(() => {
    if (!userData.data?.users) return [];
    return userData.data.users.filter((user) =>
      (user.username || '')
        .toLowerCase()
        .includes(memberSearchText.toLowerCase())
    );
  }, [userData.data?.users, memberSearchText]);

  const filteredSelectAdmins = useMemo(() => {
    if (!adminData.data?.users) return [];
    return adminData.data.users.filter((user) =>
      (user.username || '')
        .toLowerCase()
        .includes(adminSearchText.toLowerCase())
    );
  }, [adminData.data?.users, adminSearchText]);

  const handleClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    record: DomainUserGroup
  ) => {
    setAnchorEl(event.currentTarget);
    setCurrentGroup(record);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const onDeleteGroup = () => {
    handleClose();
    Modal.confirm({
      title: '提示',
      okText: '删除',
      okButtonProps: {
        color: 'error',
      },
      content: (
        <>
          确定要删除该成员组{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {currentGroup!.name}
          </Box>{' '}
          吗？
        </>
      ),
      onOk: () => {
        deleteDeleteGroup({ id: currentGroup!.id! }).then(() => {
          message.success('删除成功');
          groupData.refresh();
        });
      },
    });
  };

  const onUpdateGroup = () => {
    handleClose();
    setOpenUpdateGroupModal(true);
  };

  const columns: ColumnsType<DomainUserGroup> = [
    {
      title: '成员组',
      dataIndex: 'name',
      width: 120,
      render: (text) => {
        return text;
      },
    },
    {
      title: '成员',
      dataIndex: 'users',
      render: (users, record) => {
        return (
          <FormControl sx={{ width: '100%' }}>
            <InputLabel size='small'>成员</InputLabel>
            <Select
              multiple
              value={(users || []).map((u: DomainUser) => u.id)}
              label='成员'
              size='small'
              onClose={() => setMemberSearchText('')}
              onOpen={() => {
                setTimeout(() => {
                  memberInputRef.current?.focus();
                }, 100);
              }}
              MenuProps={{
                autoFocus: false,
              }}
              renderValue={(selectedIds: string[]) => {
                if (!Array.isArray(selectedIds)) return null;
                const selectedUsers = (userData.data?.users || []).filter(
                  (user: DomainUser) => user.id && selectedIds.includes(user.id)
                );
                return selectedUsers.map((u: DomainUser) => (
                  <Chip size='small' key={u.id} label={u.username}></Chip>
                ));
              }}
              onChange={(event: SelectChangeEvent<string[]>) => {
                console.log(event.target);
                // 获取当前分组的成员ID列表
                const currentUserIds = (users || []).map(
                  (user: DomainUser) => user.id!
                );
                // 获取选择的成员ID列表
                const selectedUserIds = event.target.value as string[];

                // 计算新增的成员ID
                const addedUserIds = selectedUserIds.filter(
                  (id) => !currentUserIds.includes(id)
                );
                // 计算移除的成员ID
                const removedUserIds = currentUserIds.filter(
                  (id: string) => !selectedUserIds.includes(id)
                );

                // 调用API添加成员
                if (addedUserIds.length > 0) {
                  postAddUserToGroup({
                    user_ids: addedUserIds,
                    group_ids: [record.id!],
                  })
                    .then(() => {
                      message.success('成员添加成功');
                      groupData.refresh();
                    })
                    .catch(() => {
                      message.error('成员添加失败');
                    });
                }

                // 调用API移除成员
                if (removedUserIds.length > 0) {
                  deleteRemoveUserFromGroup({
                    user_ids: removedUserIds,
                    group_id: record.id!,
                  })
                    .then(() => {
                      message.success('成员移除成功');
                      groupData.refresh();
                    })
                    .catch(() => {
                      message.error('成员移除失败');
                    });
                }
                setMemberSearchText('');
              }}
            >
              <Box
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{
                  p: 1,
                  position: 'sticky',
                  top: -8,
                  zIndex: 1,
                  backgroundColor: 'background.paper',
                }}
              >
                <TextField
                  size='small'
                  fullWidth
                  inputRef={memberInputRef}
                  placeholder='搜索成员'
                  onChange={(e) => setMemberSearchText(e.target.value)}
                />
              </Box>
              {filteredSelectUsers?.map((user) => (
                <MenuItem key={user.username} value={user.id}>
                  {users.some((u: DomainUser) => {
                    return u.id === user.id;
                  }) ? (
                    <>
                      {user.username}
                      <Check sx={{ ml: 2, width: '16px' }} />
                    </>
                  ) : (
                    <>{user.username}</>
                  )}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );
      },
    },
    {
      title: '管理员',
      dataIndex: 'admins',
      render: (admins, record) => {
        return (
          <FormControl sx={{ width: '100%' }}>
            <InputLabel size='small'>管理员</InputLabel>
            <Select
              multiple
              value={(admins || []).map((u: DomainAdminUser) => u.id)}
              label='管理员'
              size='small'
              onClose={() => setAdminSearchText('')}
              onOpen={() => {
                setTimeout(() => {
                  adminInputRef.current?.focus();
                }, 100);
              }}
              MenuProps={{
                autoFocus: false,
              }}
              renderValue={(selectedIds: string[]) => {
                if (!Array.isArray(selectedIds)) return null;
                const selectedAdmins = (adminData.data?.users || []).filter(
                  (user: DomainAdminUser) =>
                    user.id && selectedIds.includes(user.id)
                );
                return selectedAdmins.map((u: DomainAdminUser) => (
                  <Chip size='small' key={u.id} label={u.username}></Chip>
                ));
              }}
              onChange={(event: SelectChangeEvent<string[]>) => {
                console.log(event.target);
                // 获取当前分组的管理员ID列表
                const currentAdminIds = (admins || []).map(
                  (user: DomainAdminUser) => user.id!
                );
                // 获取选择的管理员ID列表
                const selectedAdminIds = event.target.value as string[];

                // 计算新增的管理员ID
                const addedAdminIds = selectedAdminIds.filter(
                  (id) => !currentAdminIds.includes(id)
                );
                // 计算移除的管理员ID
                const removedAdminIds = currentAdminIds.filter(
                  (id: string) => !selectedAdminIds.includes(id)
                );

                // 调用API添加管理员
                if (addedAdminIds.length > 0) {
                  postGrantGroup({
                    admin_ids: addedAdminIds,
                    group_ids: [record.id!],
                  })
                    .then(() => {
                      message.success('管理员添加成功');
                      groupData.refresh();
                    })
                    .catch(() => {
                      message.error('管理员添加失败');
                    });
                }

                // 调用API移除管理员
                if (removedAdminIds.length > 0) {
                  deleteRemoveAdminFromGroup({
                    admin_ids: removedAdminIds,
                    group_id: record.id!,
                  })
                    .then(() => {
                      message.success('管理员移除成功');
                      groupData.refresh();
                    })
                    .catch(() => {
                      message.error('管理员移除失败');
                    });
                }
                setAdminSearchText('');
              }}
            >
              <Box
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{
                  p: 1,
                  position: 'sticky',
                  top: -8,
                  zIndex: 1,
                  backgroundColor: 'background.paper',
                }}
              >
                <TextField
                  size='small'
                  fullWidth
                  inputRef={adminInputRef}
                  placeholder='搜索管理员'
                  onChange={(e) => setAdminSearchText(e.target.value)}
                />
              </Box>
              {filteredSelectAdmins?.map((user) => (
                <MenuItem key={user.username} value={user.id}>
                  {admins.some((u: DomainAdminUser) => {
                    return u.id === user.id;
                  }) ? (
                    <>
                      {user.username}
                      <Check sx={{ ml: 2, width: '16px' }} />
                    </>
                  ) : (
                    <>{user.username}</>
                  )}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );
      },
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 80,
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
    <Card sx={{ maxHeight: '500px' }}>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose}>
        <MenuItem onClick={onUpdateGroup}>修改成员组名称</MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={onDeleteGroup}>
          删除成员组
        </MenuItem>
      </Menu>

      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        sx={{ mb: 2 }}
      >
        <Box sx={{ fontWeight: 700 }}>成员组</Box>
        <Stack direction='row' gap={1}>
          <TextField
            label='搜索'
            size='small'
            onChange={(e) => setSearchUser(e.target.value)}
          />
          <Button
            variant='contained'
            color='primary'
            onClick={() => setOpenCreateGroupModal(true)}
            disabled={
              license?.edition !== DomainLicenseEdition.LicenseEditionEnterprise
            }
          >
            创建成员组
          </Button>
        </Stack>
      </Stack>
      <Table
        columns={columns}
        height='calc(100% - 53px)'
        dataSource={filteredData}
        sx={{ mx: -2 }}
        pagination={false}
        rowKey='id'
        loading={groupData.loading}
      />
      <CreateGroupModal
        open={openCreateGroupModal}
        onClose={() => setOpenCreateGroupModal(false)}
        onCreated={() => groupData.refresh()} // 添加 onCreated 回调函数
      />
      <UpdateGroupModal
        open={openUpdateGroupModal}
        onClose={() => setOpenUpdateGroupModal(false)}
        onUpdated={() => groupData.refresh()}
        group={currentGroup}
      />
    </Card>
  );
};

export default GroupList;
