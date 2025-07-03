import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { DomainCompletionRecord } from '@/api/types';
import { getListCompletionRecord } from '@/api/Billing';
import { useRequest } from 'ahooks';
import { Table } from '@c-x/ui';
import Card from '@/components/card';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Stack,
  alpha,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Autocomplete,
  TextField,
  InputAdornment,
} from '@mui/material';
import { getListUser } from '@/api/User';
import dayjs from 'dayjs';
import { ColumnsType } from '@c-x/ui/dist/Table';
import { addCommasToNumber } from '@/utils';
import CompletionDetailModal from './completionDetailModal';
import StyledLabel from '@/components/label';
import { LANG_OPTIONS } from './constant';
import { ArrowDropDown as ArrowDropDownIcon } from '@mui/icons-material';

// 防抖 hook
function useDebounce(fn: (...args: any[]) => void, delay: number) {
  const timer = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(
    (...args: any[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

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
      size: 99999,
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
    const res = await getListCompletionRecord({
      page: params.page || page,
      size: params.size || size,
      language: params.language || filterLang,
      author: params.author || filterUser,
      is_accept:
        params.is_accept === 'accepted'
          ? true
          : params.is_accept === 'unaccepted'
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
      render(value: DomainCompletionRecord['user']) {
        return value?.username;
      },
    },
    {
      dataIndex: 'task',
      title: '补全内容',
      width: 150,
      render(_, record) {
        return (
          <ButtonBase
            disableRipple
            onClick={() => setCompletionDetailModal(record)}
            sx={{ color: 'info.main' }}
          >
            点击查看
          </ButtonBase>
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
      width: 140,
    },
    {
      dataIndex: 'input_tokens',
      title: '输入 Token',
      render(value: number) {
        return addCommasToNumber(value);
      },
    },
    {
      dataIndex: 'output_tokens',
      title: '输出 Token',
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

  const debounceSetFilterLang = useDebounce(
    (val: string) => setFilterLang(val),
    500
  );

  return (
    <Card sx={{ flex: 1, height: '100%' }}>
      {/* 筛选项 */}
      <Stack direction='row' spacing={2} sx={{ mb: 2 }}>
        {/* 成员筛选 Autocomplete */}
        <Autocomplete
          size='small'
          sx={{ minWidth: 220 }}
          options={userOptions.users || []}
          getOptionLabel={(option) => option.username || ''}
          value={
            userOptions.users?.find((item) => item.username === filterUser) ||
            null
          }
          onChange={(_, newValue) =>
            setFilterUser(newValue ? newValue.username! : '')
          }
          isOptionEqualToValue={(option, value) =>
            option.username === value.username
          }
          renderInput={(params) => <TextField {...params} label='成员' />}
          clearOnEscape
        />
        {/* 语言筛选 Autocomplete */}
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
            debounceSetFilterLang(newInputValue)
          }
          popupIcon={<ArrowDropDownIcon />}
          renderInput={(params) => <TextField {...params} label='语言' />}
          clearOnEscape
        />
        {/* 是否采纳筛选 Select 保持不变 */}
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
