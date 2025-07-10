import React, { useState, useEffect } from 'react';
import { Modal, message, Loading } from '@c-x/ui';
import { Box, Typography, IconButton, Paper } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { useRequest } from 'ahooks';
import { getInvite } from '@/api/User';

const InviteUserModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const [inviteUrl, setInviteUrl] = useState('');
  const { loading, refresh } = useRequest(getInvite, {
    manual: true,
    onSuccess: (data) => {
      setInviteUrl(location.origin + '/invite/' + data?.code + '/1');
    },
  });

  const handleCopy = async () => {
    try {
      message.success('链接已复制到剪贴板');
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  useEffect(() => {
    if (open) {
      refresh();
    }
  }, [open]);

  return (
    <Modal
      title='邀请新用户'
      width={800}
      open={open}
      onOk={onClose}
      onCancel={onClose}
      showCancel={false}
      okText='关闭'
    >
      <Box>
        <Typography variant='body1' sx={{ mb: 2 }}>
          复制以下链接发送给新用户，邀请他们加入：
        </Typography>
        <Loading
          loading={loading}
          sx={{ '.MuiCircularProgress-root': { color: 'info.main' } }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 2,
              bgcolor: 'grey.50',
              borderRadius: 1,
            }}
          >
            <Typography
              variant='body2'
              sx={{
                color: 'primary.main',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}
            >
              {inviteUrl}{' '}
              <CopyToClipboard text={inviteUrl} onCopy={handleCopy}>
                <IconButton color='primary' size='small'>
                  <ContentCopyIcon sx={{ color: 'info.main', fontSize: 16 }} />
                </IconButton>
              </CopyToClipboard>
            </Typography>
          </Paper>
        </Loading>

        <Typography
          variant='caption'
          color='text.secondary'
          sx={{ mt: 1, display: 'block' }}
        >
          点击复制按钮即可复制邀请链接
        </Typography>
      </Box>
    </Modal>
  );
};

export default InviteUserModal;
