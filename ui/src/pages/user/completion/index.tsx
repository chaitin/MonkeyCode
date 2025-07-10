import { useState, useEffect } from 'react';
import { DomainCompletionRecord, DomainUser } from '@/api/types';
import { getListCompletionRecord } from '@/api/Billing';
import { useRequest } from 'ahooks';
import { Table } from '@c-x/ui';
import Card from '@/components/card';
import {
  Box,
  Stack,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Autocomplete,
  TextField,
} from '@mui/material';
import { getListUser } from '@/api/User';
import dayjs from 'dayjs';
import { useDebounceFn } from 'ahooks';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { addCommasToNumber } from '@/utils';
import CompletionDetailModal from './completionDetailModal';
import StyledLabel from '@/components/label';
import { LANG_OPTIONS } from './constant';
import User from '@/components/user';

const Completion = () => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [dataSource, setDataSource] = useState<DomainCompletionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [completionDetailModal, setCompletionDetailModal] = useState<
    DomainCompletionRecord | undefined
  >();

  // 新增筛选项 state
  const [filterUser, setFilterUser] = useState('');
  const [filterLang, setFilterLang] = useState('');
  const [filterAccept, setFilterAccept] = useState<
    'accepted' | 'unaccepted' | ''
  >('accepted');

  const { data: userOptions = { users: [] } } = useRequest(() =>
    getListUser({
      page: 1,
      size: 10,
    })
  );

  useEffect(() => {
    setPage(1); // 筛选变化时重置页码
    fetchData({
      page: 1,
      language: filterLang,
      author: filterUser,
      is_accept: filterAccept,
    });
  }, [filterUser, filterLang, filterAccept]);

  const fetchData = async (params: {
    page?: number;
    size?: number;
    language?: string;
    author?: string;
    is_accept?: 'accepted' | 'unaccepted' | '';
  }) => {
    setLoading(true);
    const isAccept = params.is_accept || filterAccept;
    const res = await getListCompletionRecord({
      page: params.page || page,
      size: params.size || size,
      language: params.language || filterLang,
      author: params.author || filterUser,
      is_accept:
        isAccept === 'accepted'
          ? true
          : isAccept === 'unaccepted'
          ? false
          : undefined,
    });
    setLoading(false);
    setTotal(res?.total_count || 0);
    setDataSource(res.records || []);
  };

  const columns: ColumnsType<DomainCompletionRecord> = [
    {
      dataIndex: 'user',
      title: '成员',
      render(value: DomainUser) {
        return (
          <User
            id={value.id!}
            username={value.username!}
            email={value.email!}
          />
        );
      },
    },
    {
      dataIndex: 'task',
      title: '补全内容',
      width: 150,
      render(_, record) {
        return (
          <Box
            onClick={() => setCompletionDetailModal(record)}
            sx={{ color: 'info.main', cursor: 'pointer' }}
          >
            点击查看
          </Box>
        );
      },
    },
    {
      dataIndex: 'is_accept',
      title: '是否采纳',
      width: 130,
      render(value: boolean) {
        const color = value ? 'success' : 'default';
        return (
          <StyledLabel color={color}>{value ? '已采纳' : '未采纳'}</StyledLabel>
        );
      },
    },
    {
      dataIndex: 'program_language',
      title: '编程语言',
      width: 160,
    },
    {
      dataIndex: 'input_tokens',
      title: '输入 Token',
      width: 140,
      render(value: number) {
        return addCommasToNumber(value);
      },
    },
    {
      dataIndex: 'output_tokens',
      title: '输出 Token',
      width: 140,
      render(value: number) {
        return addCommasToNumber(value);
      },
    },
    {
      dataIndex: 'created_at',
      title: '时间',
      width: 200,
      render(value: number) {
        return dayjs.unix(value).format('YYYY-MM-DD HH:mm:ss');
      },
    },
  ];

  const debounceSetFilterLang = useDebounceFn(
    (val: string) => setFilterLang(val),
    {
      wait: 500,
    }
  );

  return (
    <Card sx={{ flex: 1, height: '100%' }}>
      <Stack direction='row' spacing={2} sx={{ mb: 2 }}>
        <Autocomplete
          size='small'
          sx={{ minWidth: 220 }}
          options={LANG_OPTIONS}
          getOptionLabel={(option) => option || ''}
          value={filterLang || ''}
          freeSolo
          onChange={(_, newValue) => {
            setFilterLang(newValue ? String(newValue) : '');
          }}
          onInputChange={(_, newInputValue) =>
            debounceSetFilterLang.run(newInputValue)
          }
          renderInput={(params) => <TextField {...params} label='语言' />}
          clearOnEscape
        />
        <FormControl size='small' sx={{ minWidth: 180 }}>
          <InputLabel>是否采纳</InputLabel>
          <Select
            label='是否采纳'
            value={filterAccept}
            onChange={(e) =>
              setFilterAccept(e.target.value as 'accepted' | 'unaccepted')
            }
          >
            <MenuItem value=''>全部</MenuItem>
            <MenuItem value='accepted'>已采纳</MenuItem>
            <MenuItem value='unaccepted'>未采纳</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      <Table
        size='large'
        height='calc(100% - 56px)'
        loading={loading}
        columns={columns}
        dataSource={dataSource || []}
        sx={{ mx: -2 }}
        PaginationProps={{
          sx: {
            pt: 2,
            mx: 2,
          },
        }}
        rowKey='id'
        pagination={{
          pageSize: size,
          total: total,
          page: page,
          onChange: (page, size) => {
            setPage(page);
            setSize(size);
            fetchData({
              page,
              size,
            });
          },
        }}
      />

      <CompletionDetailModal
        open={!!completionDetailModal}
        onClose={() => setCompletionDetailModal(undefined)}
        data={completionDetailModal}
      />
    </Card>
  );
};

export default Completion;
