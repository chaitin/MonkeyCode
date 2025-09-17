import dayjs from 'dayjs';
import { useState } from 'react';
import { Modal } from '@ctzhian/ui';
import HelpCenter from '@/assets/json/help-center.json';
import Takeoff from '@/assets/json/takeoff.json';
import IconUpgrade from '@/assets/json/upgrade.json';
import { Box, Button, Stack } from '@mui/material';
import { DomainLicenseResp } from '@/api/types';
import ChangeLicense from './changeLicense';
import LottieIcon from '../lottieIcon';

interface LicenseModalProps {
  open: boolean;
  onClose: () => void;
  curVersion: string;
  latestVersion: string;
  license: DomainLicenseResp | undefined;
}

const AboutModal = ({
  open,
  onClose,
  curVersion,
  latestVersion,
  license,
}: LicenseModalProps) => {
  const [openChangeLicense, setOpenChangeLicense] = useState(false);

  const editionText = (edition: any) => {
    if (edition === 0) {
      return '开源版';
    } else if (edition === 1) {
      return '联创版';
    } else if (edition === 2) {
      return '企业版';
    } else {
      return '未知';
    }
  };

  return (
    <Modal
      title='关于 MonkeyCode'
      width={600}
      open={open}
      onCancel={onClose}
      footer={null}
    >
      <Stack
        direction={'column'}
        gap={2}
        sx={{
          fontSize: '14px',
        }}
      >
        <Stack direction={'row'} gap={2} alignItems={'center'}>
          <Box
            sx={{
              width: '120px',
            }}
          >
            当前版本
          </Box>
          <Box
            sx={{
              width: '120px',
              fontWeight: 700,
            }}
          >
            {curVersion}
          </Box>

          {latestVersion === `v${curVersion}` ? (
            <Box sx={{ color: 'text.auxiliary', fontSize: 12 }}>
              已是最新版本，无需更新
            </Box>
          ) : (
            <Button
              size='small'
              startIcon={
                <Box>
                  <LottieIcon
                    id='version'
                    src={latestVersion === '' ? HelpCenter : IconUpgrade}
                    style={{ width: 16, height: 16, display: 'flex' }}
                  />
                </Box>
              }
              onClick={() => {
                window.open(
                  'https://monkeycode.docs.baizhi.cloud/node/01980d22-db84-73b4-ae13-6a188e318048'
                );
              }}
            >
              立即更新
            </Button>
          )}
        </Stack>

        <Stack direction={'row'} gap={2} alignItems={'center'}>
          <Box
            sx={{
              width: '120px',
            }}
          >
            产品型号
          </Box>
          <Box>{editionText(license?.edition)}</Box>

          <Button
            size='small'
            startIcon={
              <Box>
                <LottieIcon
                  id='version'
                  src={Takeoff}
                  style={{ width: 16, height: 16, display: 'flex' }}
                />
              </Box>
            }
            onClick={() => setOpenChangeLicense(true)}
          >
            切换授权
          </Button>

          <Button
            size='small'
            startIcon={
              <Box>
                <LottieIcon
                  id='consult'
                  src={HelpCenter}
                  style={{ width: 16, display: 'flex' }}
                />
              </Box>
            }
            onClick={() => {
              window.open('https://baizhi.cloud/consult');
            }}
          >
            商务咨询
          </Button>
        </Stack>
        {license && license?.edition !== 0 && (
          <Stack direction={'row'} gap={2}>
            <Box
              sx={{
                width: '120px',
              }}
            >
              授权时间
            </Box>
            <Box sx={{}}>
              {dayjs.unix(license.started_at!).format('YYYY-MM-DD')} ~{' '}
              {dayjs.unix(license.expired_at!).format('YYYY-MM-DD')}
            </Box>
          </Stack>
        )}
      </Stack>
      <ChangeLicense
        open={openChangeLicense}
        onClose={() => {
          setOpenChangeLicense(false);
        }}
      />
    </Modal>
  );
};

export default AboutModal;
