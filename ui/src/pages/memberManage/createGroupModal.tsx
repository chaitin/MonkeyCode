import React, { useState } from 'react';
import { Modal, message } from '@ctzhian/ui';
import { Box, TextField } from '@mui/material';
import { postCreateGroup } from '@/api/UserGroup';

const CreateGroupModal = ({
  open,
  onClose,
  onCreated, // 添加一个回调函数，用于在创建成功后刷新列表
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void; // 可选的回调函数
}) => {
  const [groupName, setGroupName] = useState('');

  const handleCreate = async () => {
    if (!groupName.trim()) {
      message.error('请输入成员组名称');
      return;
    }

    try {
      await postCreateGroup({ name: groupName });
      message.success('成员组创建成功');
      setGroupName(''); // 清空输入框
      onCreated?.(); // 调用回调函数刷新列表
      onClose(); // 关闭弹窗
    } catch (error) {
      console.error('创建成员组失败:', error);
      message.error('创建成员组失败');
    }
  };

  return (
    <Modal
      title='创建成员组'
      width={500}
      open={open}
      onOk={handleCreate}
      onCancel={onClose}
      okText='创建'
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

export default CreateGroupModal;
