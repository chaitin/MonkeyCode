import Avatar from '@/components/avatar';
import Card from '@/components/card';
import { getChatInfo } from '@/api/Billing';
import MarkDown from '@/components/markDown';
import { Ellipsis, Icon, Modal } from '@c-x/ui';
import { styled } from '@mui/material/styles';
import logo from '@/assets/images/logo.png';

import { useEffect, useState } from 'react';
import { DomainChatContent, DomainChatRecord } from '@/api/types';

type ToolInfo = any;

const StyledChatList = styled('div')(() => ({
  background: '#f7f8fa',
  borderRadius: 4,
  padding: 24,
  minHeight: 400,
  maxHeight: 600,
  overflowY: 'auto',
}));

const StyledChatRow = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser }) => ({
  display: 'flex',
  flexDirection: isUser ? 'row-reverse' : 'row',
  alignItems: 'flex-start',
  marginBottom: 28,
  position: 'relative',
}));

const StyledChatAvatar = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser }) => ({
  margin: isUser ? '0 0 0 18px' : '0 18px 0 0',
  display: 'flex',
  alignItems: 'flex-start',
  position: 'relative',
  top: 0,
}));

const StyledChatBubble = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isUser',
})<{ isUser: boolean }>(({ isUser }) => ({
  background: isUser ? '#e6f7ff' : '#f5f5f5',
  borderRadius: 18,
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  padding: '16px 20px',
  minHeight: 36,
  maxWidth: 1100,
  wordBreak: 'break-word',
  position: 'relative',
  transition: 'box-shadow 0.2s',
  cursor: 'pointer',
  '&:hover': {
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  },
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
  const [showToolInfo, setShowToolInfo] = useState<{ [key: string]: ToolInfo }>(
    {}
  );

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
      width={1200}
      open={open}
      onCancel={onClose}
      footer={null}
    >
      <Card sx={{ p: 0, background: 'transparent', boxShadow: 'none' }}>
        <StyledChatList>
          {content.map((item, idx) => {
            const isUser = item.role === 'user';
            const name = isUser ? data?.user?.username : 'AI';
            const msg = item.content || '';
            return (
              <StyledChatRow key={idx} isUser={isUser}>
                <StyledChatAvatar isUser={isUser}>
                  <Avatar
                    name={isUser ? name : undefined}
                    src={isUser ? undefined : logo}
                    sx={{
                      width: 48,
                      height: 48,
                      fontSize: 22,
                    }}
                  />
                </StyledChatAvatar>
                <StyledChatBubble isUser={isUser}>
                  <MarkDown
                    showToolInfo={showToolInfo}
                    setShowToolInfo={setShowToolInfo}
                    content={msg}
                  />
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
