import { Box, Stack } from '@mui/material';
import { DomainUserCodeRank } from '@/api/types';
import { Modal } from '@ctzhian/ui';
import { StyledItem, StyledSerialNumber, StyledText } from './statisticCard';
import User from '@/components/user';
import Avatar from '@/components/avatar';

const ContributionModal = ({
  open,
  onCancel,
  data,
}: {
  open: boolean;
  onCancel: () => void;
  data: DomainUserCodeRank[];
}) => {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title='用户贡献榜'
      footer={false}
      onOk={onCancel}
    >
      <Box
        gap={0.5}
        sx={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {data.map((item, index) => (
          <Stack
            direction='row'
            alignItems='center'
            justifyContent='space-between'
            key={item.username}
          >
            <StyledItem>
              <StyledSerialNumber num={index + 1}>
                {index + 1}
              </StyledSerialNumber>
              <Stack
                direction='row'
                alignItems='center'
                gap={1.5}
                sx={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <Avatar
                  name={item.user?.username}
                  src={item.user?.avatar_url}
                  sx={{ width: 20, height: 20, fontSize: 12 }}
                />
                <StyledText className='active-user-name'>
                  {item.username}
                </StyledText>
              </Stack>
            </StyledItem>
            <Box sx={{ fontSize: 14 }}>{item.lines} 行</Box>
          </Stack>
        ))}
      </Box>
    </Modal>
  );
};

export default ContributionModal;
