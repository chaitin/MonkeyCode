import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import { Box, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const ADMIN_BREADCRUMB_MAP: Record<string, { title: string; to: string }> = {
  dashboard: { title: '仪表盘', to: '/' },
  chat: { title: '对话记录', to: '/chat' },
  completion: { title: '补全记录', to: '/completion' },
  model: { title: '模型管理', to: '/model' },
  'user-management': { title: '成员管理', to: '/user-management' },
  admin: { title: '管理员', to: '/admin' },
};

const USER_BREADCRUMB_MAP: Record<string, { title: string; to: string }> = {
  dashboard: { title: '仪表盘', to: '/user/dashboard' },
  chat: { title: '对话记录', to: '/user/chat' },
  completion: { title: '补全记录', to: '/user/completion' },
};

const Bread = () => {
  const { pathname } = useLocation();

  const breadcrumbs = useMemo(() => {
    const pathParts = pathname.split('/').filter(Boolean);

    const generatedCrumbs = pathParts
      .map((part) => {
        if (pathname.startsWith('/user/')) {
          return USER_BREADCRUMB_MAP[part];
        }
        return ADMIN_BREADCRUMB_MAP[part];
      })
      .filter(Boolean);

    return [
      {
        title: 'MonkeyCode',
        to: pathname.startsWith('/user/') ? '/user/dashboard' : '/dashboard',
      },
      ...generatedCrumbs,
    ];
  }, [pathname]);

  return (
    <Stack
      direction='row'
      alignItems='center'
      gap={1}
      component='nav'
      aria-label='breadcrumb'
      sx={{
        flexGrow: 1,
        fontSize: '14px',
      }}
    >
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;

        const crumbContent = (
          <Stack direction='row' alignItems='center' gap={1}>
            {index > 0 && (
              <KeyboardArrowRightRoundedIcon sx={{ fontSize: 14 }} />
            )}
            <Typography
              variant='body2'
              sx={{
                fontWeight: isLast ? 'bold' : 'normal',
              }}
            >
              {crumb.title}
            </Typography>
          </Stack>
        );

        if (isLast) {
          return (
            <Box key={index} sx={{ color: 'text.primary' }}>
              {crumbContent}
            </Box>
          );
        }

        if (crumb.to === 'custom') {
          return (
            <Box
              key={index}
              sx={{
                color: 'text.disabled',
                cursor: 'pointer',
                '&:hover': {
                  color: 'primary.main',
                },
              }}
            >
              {crumbContent}
            </Box>
          );
        }

        return (
          <NavLink
            key={index}
            to={crumb.to}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <Box
              sx={{
                color: 'text.disabled',
                '&:hover': {
                  color: 'primary.main',
                },
              }}
            >
              {crumbContent}
            </Box>
          </NavLink>
        );
      })}
    </Stack>
  );
};

export default Bread;
