import React, { useState, useEffect } from 'react';
import { Modal, message } from '@ctzhian/ui';
import { Box, TextField } from '@mui/material';
import { putUpdateUserGroup } from '@/api/UserGroup';
import { DomainUserGroup } from '@/api/types';

interface UpdateGroupModalProps {
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  group: DomainUserGroup | null;
}

const UpdateGroupModal = ({
  open,
  onClose,
  onUpdated,
  group,
}: UpdateGroupModalProps) => {
  const [groupName, setGroupName] = useState('');

  // 当group变化时，更新表单中的组名
  useEffect(() => {
    if (group) {
      setGroupName(group.name || '');
    }
  }, [group]);

  const handleUpdate = async () => {
    if (!groupName.trim()) {
      message.error('请输入成员组名称');
      return;
    }

    if (!group?.id) {
      message.error('无效的成员组');
      return;
    }

    try {
      await putUpdateUserGroup({ id: group.id, name: groupName });
      message.success('成员组名称更新成功');
      setGroupName(''); // 清空输入框
      onUpdated?.(); // 调用回调函数刷新列表
      onClose(); // 关闭弹窗
    } catch (error) {
      console.error('更新成员组名称失败:', error);
      message.error('更新成员组名称失败');
    }
  };

  return (
    <Modal
      title='修改成员组名称'
      width={500}
      open={open}
      onOk={handleUpdate}
      onCancel={onClose}
      okText='确定'
      cancelText='取消'
    >
      <Box sx={{ mt: 2 }}>
        <TextField
          label='成员组名称'
          fullWidth
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          variant='outlined'
        />
      </Box>
    </Modal>
  );
};

export default UpdateGroupModal;
