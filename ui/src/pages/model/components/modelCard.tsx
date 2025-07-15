import React, { useState } from 'react';
import Card from '@/components/card';
import { useRequest } from 'ahooks';
import { getMyModelList, putUpdateModel } from '@/api/Model';
import { DomainModel, ConstsModelStatus, ConstsModelType } from '@/api/types';
import { Stack, Box, Button, Grid2 as Grid, ButtonBase } from '@mui/material';
import StyledLabel from '@/components/label';
import { Icon, Modal, message } from '@c-x/ui';
import { addCommasToNumber } from '@/utils';
import NoData from '@/assets/images/nodata.png';
import { ModelProvider } from '../constant';
import ModelModal from './modelModal';

const ModelItem = ({
  data,
  onEdit,
  refresh,
}: {
  data: DomainModel;
  onEdit: (data: DomainModel) => void;
  refresh: () => void;
}) => {
  const onInactiveModel = () => {
    Modal.confirm({
      title: '停用模型',
      content: (
        <>
          确定要停用{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.model_name}
          </Box>{' '}
          模型吗？
        </>
      ),
      okText: '停用',
      okButtonProps: {
        color: 'error',
      },
      onOk: () => {
        putUpdateModel({
          id: data.id,
          status: ConstsModelStatus.ModelStatusInactive,
          provider: data.provider!,
        }).then(() => {
          message.success('停用成功');
          refresh();
        });
      },
    });
  };

  const onActiveModel = () => {
    Modal.confirm({
      title: '激活模型',
      content: (
        <>
          确定要激活{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.model_name}
          </Box>{' '}
          模型吗？
        </>
      ),
      onOk: () => {
        putUpdateModel({
          id: data.id,
          status: ConstsModelStatus.ModelStatusActive,
          provider: data.provider!,
        }).then(() => {
          message.success('激活成功');
          refresh();
        });
      },
    });
  };

  return (
    <Card
      sx={{
        overflow: 'hidden',
        position: 'relative',
        transition: 'all 0.3s ease',
        borderStyle: 'solid',
        borderWidth: '1px',
        borderColor: data.is_active ? 'success.main' : 'transparent',
        boxShadow:
          '0px 0px 10px 0px rgba(68, 80, 91, 0.1), 0px 0px 2px 0px rgba(68, 80, 91, 0.1)',
        '&:hover': {
          boxShadow:
            'rgba(54, 59, 76, 0.3) 0px 10px 30px 0px, rgba(54, 59, 76, 0.03) 0px 0px 1px 1px',
        },
        // '&::before': {
        //   content: '""',
        //   position: 'absolute',
        //   top: 0,
        //   left: 0,
        //   right: 0,
        //   height: 3,
        //   background: data.is_active
        //     ? 'linear-gradient(90deg, #4CAF50, #66BB6A)'
        //     : 'linear-gradient(90deg, #E0E0E0, #BDBDBD)',
        //   transition: 'all 0.3s ease',
        // },
      }}
    >
      <Stack
        direction='row'
        alignItems='center'
        justifyContent='space-between'
        sx={{ height: 28 }}
      >
        <Stack direction='row' alignItems='center' gap={1}>
          <Icon
            type={
              ModelProvider[data.provider as keyof typeof ModelProvider]?.icon
            }
            sx={{ fontSize: 24 }}
          />
          <Box sx={{ fontWeight: 700 }}>{data.model_name}</Box>
        </Stack>

        {data.is_active && <StyledLabel color='success'>正在使用</StyledLabel>}
      </Stack>
      <Stack
        gap={1}
        sx={{
          mt: 3,
          pb: 2,
          borderBottom: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Stack
          direction='row'
          alignItems='center'
          justifyContent='space-between'
          sx={{ fontSize: 14 }}
        >
          <Box sx={{ color: 'text.tertiary' }}>输入 Token 使用量</Box>
          <Box sx={{ fontWeight: 700 }}>{addCommasToNumber(data.input)}</Box>
        </Stack>
        <Stack
          direction='row'
          alignItems='center'
          justifyContent='space-between'
          sx={{ fontSize: 14 }}
        >
          <Box sx={{ color: 'text.tertiary' }}>输出 Token 使用量</Box>
          <Box sx={{ fontWeight: 700 }}>{addCommasToNumber(data.output)}</Box>
        </Stack>
      </Stack>
      <Stack
        direction='row-reverse'
        justifyContent='space-between'
        gap={2}
        sx={{ mt: 2 }}
      >
        <Stack
          direction='row'
          justifySelf='flex-end'
          sx={{ button: { minWidth: 0 } }}
          gap={2}
        >
          <ButtonBase
            disableRipple
            sx={{
              color: 'info.main',
            }}
            onClick={() => onEdit(data)}
          >
            编辑
          </ButtonBase>
          {!data.is_active && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'success.main',
              }}
              onClick={onActiveModel}
            >
              激活
            </ButtonBase>
          )}

          {data.is_active && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'error.main',
              }}
              onClick={onInactiveModel}
            >
              停用
            </ButtonBase>
          )}
          {/* <Button color='error' size='small'>
            删除
          </Button> */}
        </Stack>
      </Stack>
    </Card>
  );
};

interface IModelCardProps {
  title: string;
  modelType: ConstsModelType;
}

const ModelCard: React.FC<IModelCardProps> = ({ title, modelType }) => {
  const [open, setOpen] = useState(false);
  const [editData, setEditData] = useState<DomainModel | null>(null);

  const onEdit = (data: DomainModel) => {
    setOpen(true);
    setEditData(data);
  };

  const { data: modelList = [], refresh } = useRequest(() =>
    getMyModelList({
      model_type: modelType,
    })
  );

  return (
    <Card>
      <Stack direction='row' justifyContent='space-between' alignItems='center'>
        <Box sx={{ fontWeight: 700 }}>{title}</Box>
        <Button
          variant='contained'
          color='primary'
          onClick={() => setOpen(true)}
        >
          添加模型
        </Button>
      </Stack>
      {modelList?.length > 0 ? (
        <Grid container spacing={2} sx={{ mt: 2 }}>
          {modelList.map((item) => (
            <Grid size={4} key={item.id}>
              <ModelItem data={item} onEdit={onEdit} refresh={refresh} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Stack alignItems={'center'} sx={{ mt: 2 }}>
          <img src={NoData} width={150} alt='empty' />
          <Box sx={{ color: 'text.tertiary', fontSize: 12 }}>
            暂无模型，请先添加模型
          </Box>
        </Stack>
      )}

      <ModelModal
        open={open}
        onClose={() => {
          setOpen(false);
          setEditData(null);
        }}
        refresh={refresh}
        data={editData}
        type={modelType}
      />
    </Card>
  );
};

export default ModelCard;
