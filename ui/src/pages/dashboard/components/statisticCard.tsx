import React from 'react';
import { styled, Stack, Box } from '@mui/material';
import { Empty } from '@c-x/ui';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { TimeRange } from '../index';

import Card from '@/components/card';
import {
  DomainStatistics,
  DomainUserCodeRank,
  DomainUserEvent,
} from '@/api/types';

const StyledCardLabel = styled('div')(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.secondary,
}));

const StyledCardValue = styled('div')(({ theme }) => ({
  fontSize: 40,
  color: theme.palette.text.primary,
  fontWeight: 700,
}));

const StyledItem = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
}));

const StyledText = styled('a')(({ theme }) => ({
  fontSize: 14,
  color: theme.palette.text.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}));

const StyledSerialNumber = styled('span')<{ num: number }>(({ theme, num }) => {
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
});

export const ContributionCard = ({
  data = [],
  timeRange,
}: {
  data?: DomainUserCodeRank[];
  timeRange: TimeRange;
}) => {
  const navigate = useNavigate();

  return (
    <Card sx={{ height: '100%' }}>
      <Stack direction='row' justifyContent='space-between' alignItems='center'>
        <Box sx={{ fontWeight: 700 }}>用户贡献榜</Box>
        <Box sx={{ fontSize: 12, color: 'text.tertiary' }}>
          {timeRange === '90d' ? '最近 90 天' : '最近 24 小时'}
        </Box>
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
                  minWidth: 0,
                  // cursor: 'pointer',
                  // '&:hover': {
                  //   '.active-user-name': {
                  //     color: 'primary.main',
                  //   },
                  // },
                }}
                // onClick={() => {
                //   navigate(`/`)
                //   // window.open(`/discussion/user/${item.id}`);
                // }}
              >
                {/* <Avatar size={24} src={item.avatar} /> */}
                <StyledText className='active-user-name'>
                  {item.username}
                </StyledText>
              </Stack>
            </StyledItem>
            <Box sx={{ fontSize: 14 }}>{item.lines}</Box>
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
