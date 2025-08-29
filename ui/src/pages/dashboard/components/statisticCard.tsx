import { Empty } from '@c-x/ui';
import { Box, Stack, styled } from '@mui/material';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ContributionModal from './contributionModal';

import {
  DomainStatistics,
  DomainUserCodeRank,
  DomainUserEvent,
} from '@/api/types';
import Avatar from '@/components/avatar';
import Card from '@/components/card';

const StyledCardLabel = styled('div')(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.secondary,
}));

const StyledCardValue = styled('div')(({ theme }) => ({
  fontSize: 40,
  color: theme.palette.text.primary,
  fontWeight: 700,
}));

export const StyledItem = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
}));

export const StyledText = styled('a')(({ theme }) => ({
  fontSize: 14,
  color: theme.palette.text.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}));

export const StyledSerialNumber = styled('span')<{ num: number }>(
  ({ theme, num }) => {
    const numToColor = {
      1: '#FE4545',
      2: '#FF6600',
      3: '#FFC600',
    };
    const color = numToColor[num as 1] || '#BCBCBC';
    return {
      color: color,
      fontSize: 14,
      fontWeight: 700,
      width: 8,
    };
  }
);

export const ContributionCard = ({
  data = [],
}: {
  data?: DomainUserCodeRank[];
}) => {
  const navigate = useNavigate();
  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  return (
    <Card sx={{ height: '100%' }}>
      <ContributionModal
        open={contributionModalOpen}
        onCancel={() => setContributionModalOpen(false)}
        data={data}
      />
      <Stack direction='row' justifyContent='space-between' alignItems='center'>
        <Stack
          direction='row'
          alignItems='center'
          gap={1}
          sx={{ fontWeight: 700 }}
        >
          用户贡献榜
          <Box
            sx={{
              fontSize: 12,
              color: 'info.main',
              cursor: 'pointer',
              fontWeight: 400,
            }}
            onClick={() => setContributionModalOpen(true)}
          >
            查看更多
          </Box>
        </Stack>
      </Stack>

      <Box
        gap={0.5}
        sx={{
          mt: 2,
          display: 'flex',
          flexDirection: 'column',
          height: 120,
        }}
      >
        {data.slice(0, 5).map((item, index) => (
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
                  minWidth: 0
                }}
              >
                <Avatar
                  name={item.user?.username}
                  src={item.user?.avatar_url}
                  sx={{ width: 20, height: 20, fontSize: 12 }}
                />
                <StyledText className='active-user-name'>{item.username}
                </StyledText>
              </Stack>
            </StyledItem>
            <Box sx={{ fontSize: 14 }}>{item.lines} 行</Box>
          </Stack>
        ))}
      </Box>
    </Card>
  );
};

export const UserCard = ({ data = {} as DomainStatistics }) => {
  return (
    <Card
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: 200,
        background: 'linear-gradient( 180deg, #D7EBFD 0%, #BEDDFD 100%)',
      }}
    >
      <Stack direction='row' gap={1} alignItems='center'>
        {/* <Icon type='icon-xiaofei' sx={{ color: '#3248F2' }}></Icon> */}
        <Box
          sx={{
            color: '#021D70',
          }}
        >
          总用户数
        </Box>
      </Stack>
      <StyledCardValue
        sx={{
          color: '#021D70',
        }}
      >
        {data?.total_users || 0}
      </StyledCardValue>
      <StyledCardLabel>
        其中 {data?.disabled_users || 0} 个用户被禁用
      </StyledCardLabel>
    </Card>
  );
};

export const RecentActivityCard = ({
  data = [],
}: {
  data?: DomainUserEvent[];
}) => {
  return (
    <Card sx={{ height: '100%' }}>
      <Box sx={{ fontWeight: 700 }}>近期活动</Box>
      <Stack gap={1.8} sx={{ mt: 2 }}>
        {data.length > 0 ? (
          data.slice(0, 10).map((item, index) => (
            <Stack
              key={index}
              direction='row'
              gap={3}
              alignItems='center'
              justifyContent='space-between'
            >
              <Box
                sx={{ fontSize: 14, color: 'text.secondary' }}
                className='text-ellipsis'
              >
                {item.name}
              </Box>
              <Box sx={{ fontSize: 14, color: 'text.tertiary', flexShrink: 0 }}>
                {dayjs.unix(item.created_at!).fromNow()}
              </Box>
            </Stack>
          ))
        ) : (
          <Empty sx={{ height: 300 }} />
        )}
      </Stack>
    </Card>
  );
};
