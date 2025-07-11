import Avatar from '@/components/avatar';
import Card from '@/components/card';
import { getChatInfo } from '@/api/Billing';
import MarkDown from '@/components/markDown';
import { Ellipsis, Modal } from '@c-x/ui';
import { styled } from '@mui/material';
import logo from '@/assets/images/logo.png';

import { useEffect, useState } from 'react';
import { DomainChatContent, DomainChatRecord } from '@/api/types';

const StyledChatList = styled('div')(() => ({
  borderRadius: 4,
  padding: 24,
  minHeight: 400,
  maxHeight: 600,
  overflowY: 'auto',
}));

const StyledChatRow = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser, theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: isUser ? 'flex-end' : 'flex-start',
  gap: theme.spacing(1),
  marginBottom: theme.spacing(2),
}));

const StyledChatUser = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser }) => ({
  display: 'flex',
  flexDirection: isUser ? 'row-reverse' : 'row',
  alignItems: 'center',
  position: 'relative',
}));

const StyledChatName = styled('div')(({ theme }) => ({
  color: theme.vars.palette.text.primary,
  fontSize: '14px',
  fontWeight: 500,
}));

const StyledChatAvatar = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser }) => ({
  margin: isUser ? '0 0 0 12px' : '0 12px 0 0',
  display: 'flex',
  alignItems: 'flex-start',
  position: 'relative',
  top: 0,
}));

const StyledChatBubble = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser }) => ({
  background: isUser ? '#e6f7ff' : '#f5f5f5',
  margin: isUser ? '0 36px 0 0' : '0 0 0 36px',
  borderRadius: 12,
  padding: '8px 12px',
  minHeight: 36,
  maxWidth: 1040,
  wordBreak: 'break-word',
  position: 'relative',
}));

const ChatDetailModal = ({
  data,
  open,
  onClose,
}: {
  data?: DomainChatRecord;
  open: boolean;
  onClose: () => void;
}) => {
  const [content, setContent] = useState<DomainChatContent[]>([]);

  const getChatDetailModal = () => {
    if (!data) return;
    getChatInfo({ id: data.id! }).then((res) => {
      setContent(res.contents || []);
    });
  };

  useEffect(() => {
    if (open) getChatDetailModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, open]);

  return (
    <Modal
      title={
        <Ellipsis
          sx={{
            fontWeight: 'bold',
            fontSize: 20,
            lineHeight: '22px',
            width: 700,
          }}
        >
          对话记录-{data?.user?.username}
        </Ellipsis>
      }
      sx={{
        '.MuiDialog-paper': {
          maxWidth: 1300,
        },
      }}
      width={1200}
      open={open}
      onCancel={onClose}
      footer={null}
    >
      <Card sx={{ p: 0, background: 'transparent', boxShadow: 'none' }}>
        <StyledChatList>
          {content.map((item, idx) => {
            const isUser = item.role === 'user';
            const name = isUser ? data?.user?.username : 'MonkeyCode';
            const msg = item.content || '';
            return (
              <StyledChatRow key={idx} isUser={isUser}>
                <StyledChatUser key={idx} isUser={isUser}>
                  <StyledChatAvatar isUser={isUser}>
                    <Avatar
                      name={isUser ? name : undefined}
                      src={isUser ? undefined : logo}
                      sx={{
                        width: 24,
                        height: 24,
                        fontSize: 16,
                      }}
                    />
                  </StyledChatAvatar>
                  <StyledChatName>{name}</StyledChatName>
                </StyledChatUser>
                <StyledChatBubble isUser={isUser}>
                  <MarkDown content={msg} />
                </StyledChatBubble>
              </StyledChatRow>
            );
          })}
        </StyledChatList>
      </Card>
    </Modal>
  );
};

export default ChatDetailModal;
