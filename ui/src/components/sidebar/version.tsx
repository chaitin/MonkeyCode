import HelpCenter from '@/assets/json/help-center.json';
import IconUpgrade from '@/assets/json/upgrade.json';
import LottieIcon from '@/components/lottieIcon';
import { Box, Stack, Tooltip } from '@mui/material';
import { Icon } from '@c-x/ui';
import { useEffect, useState } from 'react';
import packageJson from '../../../package.json';

const Version = () => {
  const curVersion = import.meta.env.VITE_APP_VERSION || packageJson.version;
  const [latestVersion, setLatestVersion] = useState<string | undefined>(
    undefined
  );

  useEffect(() => {
    fetch('https://release.baizhi.cloud/monkeycode/version.txt')
      .then((response) => response.text())
      .then((data) => {
        setLatestVersion(data);
      })
      .catch((error) => {
        console.error(error);
        setLatestVersion('');
      });
  }, []);

  if (latestVersion === undefined) return null;

  return (
    <Stack
      justifyContent={'center'}
      alignItems={'center'}
      gap={0.5}
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        pt: 2,
        mt: 1,
        cursor: 'pointer',
        color: 'text.primary',
        fontSize: 12,
        '&:hover': {
          color: 'primary.main',
        },
      }}
      onClick={() => {
        window.open(
          'https://pandawiki.docs.baizhi.cloud/node/01971615-05b8-7924-9af7-15f73784f893'
        );
      }}
    >
      <Stack direction={'row'} alignItems={'center'} gap={0.5}>
        <Icon type='icon-banben' sx={{ fontSize: 16, color: 'success.main' }} />
        免费版
      </Stack>
      <Stack direction={'row'} alignItems={'center'} gap={0.5}>
        <Box sx={{ whiteSpace: 'nowrap' }}>{curVersion}</Box>
        {latestVersion !== `v${curVersion}` && (
          <Tooltip
            placement='top'
            arrow
            title={
              latestVersion === ''
                ? '无法获取最新版本'
                : '检测到新版本，点击查看'
            }
          >
            <Box>
              <LottieIcon
                id='version'
                src={latestVersion === '' ? HelpCenter : IconUpgrade}
                style={{ width: 16, height: 16 }}
              />
            </Box>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
};

export default Version;
