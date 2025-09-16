import dayjs from 'dayjs';
import { useState } from 'react';
import { Ellipsis, message, Modal } from '@ctzhian/ui';
import { Box, Button, Link, Stack, TextField } from '@mui/material';
import { DomainLicenseResp } from '@/api/types';
import { v1LicenseCreate } from '@/api';

interface LicenseModalProps {
  open: boolean;
  onClose: () => void;
}

const ChangeLicense = ({ open, onClose }: LicenseModalProps) => {
  const [code, setCode] = useState('');
  const [verifing, setVerifing] = useState(false);

  const updateLicense = () => {
    if (code.length === 0) {
      message.error('授权码不能为空');
      return;
    }
    setVerifing(true);
    v1LicenseCreate({
      license_type: 'code',
      license_code: code,
      license_file: '' as any,
    })
      .then((resp: DomainLicenseResp) => {
        message.success('切换授权成功');
        console.log(resp);
        setVerifing(false);
        onClose();
        setTimeout(() => {
          location.reload();
        }, 1000);
      })
      .catch(() => {
        message.error('遇到一点意外，无法激活');
        setVerifing(false);
      });
  };

  return (
    <Modal
      title='切换 MonkeyCode 授权'
      width={400}
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
        <Stack
          direction={'row'}
          gap={2}
          sx={{
            fontSize: '14px',
          }}
        >
          <TextField
            label='授权码'
            variant='outlined'
            sx={{
              width: '100%',
            }}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Stack>
        <Stack
          direction={'row'}
          gap={2}
          sx={{
            fontSize: '14px',
          }}
        >
          <Button
            variant='contained'
            loading={verifing}
            sx={{
              width: '100%',
            }}
            onClick={() => {
              updateLicense();
            }}
          >
            在线激活
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
};

export default ChangeLicense;
