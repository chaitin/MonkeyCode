import {
  DomainUser,
  DomainUserHeatmap,
  DomainUserHeatmapResp,
} from '@/api/types';
import Avatar from '@/components/avatar';
import Card from '@/components/card';
import { Icon } from '@ctzhian/ui';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  useTheme,
} from '@mui/material';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';

const getRecent1YearData = (
  data: DomainUserHeatmap[] = [],
  max_count: number
) => {
  const today = dayjs();
  const lastYearToday = today.subtract(1, 'year');
  const diffInDays = today.diff(lastYearToday, 'day');
  const result: { count: number; date: string; level: number }[] = [];
  const dateMap: Record<string, number> = {};
  data.forEach((item) => {
    dateMap[dayjs.unix(item.date!).format('YYYY-MM-DD')] = item.count!;
  });

  const getLevel = (count: number) => {
    if (count === 0) return 0;
    if (count === 1) return 1;
    if (count <= Math.max(2, max_count * 0.25)) return 2;
    if (count <= Math.max(3, max_count * 0.6)) return 3;
    return 4;
  };

  for (let i = 0; i < diffInDays; i++) {
    const time = today.subtract(i, 'day').format('YYYY-MM-DD');
    const count = dateMap[time] || 0;
    result.unshift({
      count,
      date: time,
      level: getLevel(count),
    });
  }
  return result;
};

// 自定义Hook：处理ActivityCalendar自动滚动
const useActivityCalendarAutoScroll = () => {
  const scrollToLatest = useCallback(() => {
    // 尝试多种可能的选择器策略
    const selectors = [
      '.react-activity-calendar__scroll-container',
      '.react-activity-calendar [style*="overflow"]',
      '.react-activity-calendar > div:first-child',
    ];

    let scrollContainer: HTMLElement | null = null;

    // 按优先级尝试找到滚动容器
    for (const selector of selectors) {
      scrollContainer = document.querySelector(selector);
      if (
        scrollContainer &&
        scrollContainer.scrollWidth > scrollContainer.clientWidth
      ) {
        break;
      }
    }

    if (scrollContainer) {
      // 滚动到最右侧（最新数据）
      scrollContainer.scrollLeft =
        scrollContainer.scrollWidth - scrollContainer.clientWidth;
    }
  }, []);

  const setupAutoScroll = useCallback(() => {
    // 延迟执行确保组件完全渲染
    const timeoutId = setTimeout(scrollToLatest, 100);

    // 使用ResizeObserver监听容器大小变化
    let resizeObserver: ResizeObserver | null = null;

    const setupResizeObserver = () => {
      const container = document.querySelector('.react-activity-calendar');
      if (container && 'ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => {
          scrollToLatest();
        });
        resizeObserver.observe(container);
      } else {
        // 降级方案：使用window resize事件
        window.addEventListener('resize', scrollToLatest);
      }
    };

    // 延迟设置ResizeObserver确保DOM已渲染
    const observerTimeoutId = setTimeout(setupResizeObserver, 150);

    // 清理函数
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(observerTimeoutId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', scrollToLatest);
      }
    };
  }, [scrollToLatest]);

  return { setupAutoScroll };
};

// 简化的blockSize计算Hook - 保持原有大小
const useBlockSize = (containerRef: React.RefObject<HTMLElement>) => {
  const [blockSize, setBlockSize] = useState(8);

  useEffect(() => {
    const calculateBlockSize = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const baseWidth = 980;
      const blockIncrement = 54;

      // 只在桌面端进行计算，保持原有逻辑
      const increment = Math.max(
        0,
        Math.ceil((containerWidth - baseWidth) / blockIncrement)
      );
      setBlockSize(increment + 8);
    };

    // 初始计算
    calculateBlockSize();

    // 使用ResizeObserver监听容器大小变化
    let resizeObserver: ResizeObserver | null = null;

    if ('ResizeObserver' in window && containerRef.current) {
      resizeObserver = new ResizeObserver(calculateBlockSize);
      resizeObserver.observe(containerRef.current);
    } else {
      // 降级方案
      window.addEventListener('resize', calculateBlockSize);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', calculateBlockSize);
      }
    };
  }, [containerRef]);

  return blockSize;
};

const MemberInfo = ({
  data,
  memberData,
  userList,
  onMemberChange,
}: {
  data: DomainUserHeatmapResp;
  memberData: DomainUser | null;
  userList?: DomainUser[];
  onMemberChange?: (data: DomainUser) => void;
}) => {
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const [searchUser, setSearchUser] = useState('');
  const [filterUser, setFilterUser] = useState<DomainUser[]>([]);

  useEffect(() => {
    if (searchUser) {
      setFilterUser(
        userList?.filter((item) =>
          (item.username || '')
            .toLowerCase()
            ?.includes(searchUser.toLowerCase())
        ) || []
      );
    } else {
      setFilterUser(userList || []);
    }
  }, [searchUser, userList]);
  // 使用自定义Hooks
  const blockSize = useBlockSize(ref as React.RefObject<HTMLElement>);
  const { setupAutoScroll } = useActivityCalendarAutoScroll();

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearchUser('');
  };

  // 设置自动滚动
  useEffect(() => {
    const cleanup = setupAutoScroll();
    return cleanup;
  }, [setupAutoScroll, data, memberData]);

  return (
    <Card
      ref={ref}
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        '.react-activity-calendar__scroll-container': {
          p: '1px',
        },
      }}
    >
      <Stack
        gap={1}
        justifyContent='space-between'
        sx={{
          bgcolor: '#f8f9fa',
          p: 2,
          borderRadius: 2.5,
          width: 240,
        }}
      >
        <Stack gap={2}>
          <Menu
            id='basic-menu'
            anchorEl={anchorEl}
            open={open}
            onClose={handleClose}
            autoFocus={false}
            disableAutoFocusItem={false}
            slotProps={{
              paper: {
                sx: {
                  p: 1,
                  maxHeight: '200px',
                },
              },
            }}
          >
            <TextField
              label='搜索'
              size='small'
              onChange={(e) => {
                e.stopPropagation();
                setSearchUser(e.target.value);
              }}
              value={searchUser}
              sx={{ mb: 1, position: 'sticky', top: '10px', zIndex: 1000 }}
            />
            {filterUser?.map((item) => (
              <MenuItem
                autoFocus={false}
                key={item.id}
                selected={memberData?.id === item.id}
                onClick={() => {
                  onMemberChange?.(item);
                  handleClose();
                }}
                sx={{
                  fontSize: 14,
                }}
              >
                {item.username}
              </MenuItem>
            ))}
          </Menu>
          <Stack
            direction='row'
            alignItems='center'
            justifyContent='space-between'
            sx={{ mb: 1 }}
          >
            <Avatar name={memberData?.username || ''} />
            {userList && (
              <IconButton onClick={handleClick} size='small'>
                <Icon
                  type='icon-qiehuan'
                  sx={{ fontSize: 16, color: 'text.primary' }}
                />
              </IconButton>
            )}
          </Stack>
          <Box sx={{ fontSize: 16, fontWeight: 700 }}>
            {memberData?.username}
          </Box>
        </Stack>

        <Box sx={{ fontSize: 14, color: 'text.tertiary' }}>
          {dayjs.unix(memberData?.created_at || 0).fromNow()}加入
        </Box>
      </Stack>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          minWidth: 0,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <ActivityCalendar
          data={getRecent1YearData(data.points || [], data?.max_count || 1)}
          colorScheme='light'
          blockSize={blockSize}
          theme={{
            light: [
              theme.palette.grey[100],
              theme.palette.grey[300],
              theme.palette.grey[500],
              theme.palette.grey[700],
              theme.palette.grey[900],
            ],
          }}
          labels={{
            totalCount: '{{count}} 次使用',
            months: [
              '一月',
              '二月',
              '三月',
              '四月',
              '五月',
              '六月',
              '七月',
              '八月',
              '九月',
              '十月',
              '十一月',
              '十二月',
            ],
            weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
            legend: {
              less: '较少',
              more: '较多',
            },
          }}
          renderBlock={(block, activity) => (
            <Tooltip
              slotProps={{
                tooltip: {
                  sx: {
                    mb: '0 !important',
                  },
                },
              }}
              title={
                <Box
                  sx={{ height: 14 }}
                >{`${activity.date} ${activity.count} 次使用`}</Box>
              }
              placement='top'
            >
              {block}
            </Tooltip>
          )}
        />
      </Box>
    </Card>
  );
};

export default MemberInfo;
