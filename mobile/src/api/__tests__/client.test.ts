const mockFetch = jest.fn();
const xhrs: MockXHR[] = [];

class MockXHR {
  status = 200;
  responseText = '{"code":0}';
  withCredentials = false;
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn();
  abort = jest.fn(() => this.onabort?.());

  constructor() {
    xhrs.push(this);
  }
}

import { request } from '../client';

beforeAll(() => {
  (global as any).fetch = mockFetch;
  (global as any).XMLHttpRequest = MockXHR;
});

beforeEach(() => {
  jest.clearAllMocks();
  xhrs.length = 0;
});

test('request sends FormData with cookies, abort signal, and no manual content type', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ code: 0 }),
  });
  const formData = {} as FormData;
  const controller = new AbortController();

  await request('/api/v1/users/files/upload', {
    method: 'POST',
    query: { id: 'vm-1', path: '/workspace/empty.txt' },
    formData,
    signal: controller.signal,
  });

  expect(mockFetch).toHaveBeenCalledWith(
    'https://monkeycode-ai.com/api/v1/users/files/upload?id=vm-1&path=%2Fworkspace%2Fempty.txt',
    {
      method: 'POST',
      credentials: 'include',
      headers: undefined,
      body: formData,
      signal: controller.signal,
    },
  );
});

test('request uses credentialed XHR and reports multipart upload progress', async () => {
  const formData = {} as FormData;
  const onProgress = jest.fn();

  const pending = request('/api/v1/users/files/upload', {
    method: 'POST',
    query: { id: 'vm-1', path: '/workspace/large.bin' },
    formData,
    onUploadProgress: onProgress,
  });
  const xhr = xhrs[0];

  expect(xhr.open).toHaveBeenCalledWith(
    'POST',
    'https://monkeycode-ai.com/api/v1/users/files/upload?id=vm-1&path=%2Fworkspace%2Flarge.bin',
    true,
  );
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.send).toHaveBeenCalledWith(formData);
  expect(xhr.setRequestHeader).not.toHaveBeenCalledWith('Content-Type', expect.anything());
  xhr.upload.onprogress?.({ loaded: 5 * 1024 * 1024, total: 10 * 1024 * 1024, lengthComputable: true });
  expect(onProgress).toHaveBeenCalledWith(5 * 1024 * 1024, 10 * 1024 * 1024);

  xhr.onload?.();
  await expect(pending).resolves.toEqual({ code: 0 });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('request aborts an in-progress XHR upload', async () => {
  const controller = new AbortController();
  const pending = request('/api/v1/users/files/upload', {
    method: 'POST',
    formData: {} as FormData,
    signal: controller.signal,
    onUploadProgress: jest.fn(),
  });
  const xhr = xhrs[0];

  controller.abort();

  await expect(pending).rejects.toThrow('请求已取消');
  expect(xhr.abort).toHaveBeenCalledTimes(1);
});

test('request preserves a business error returned after an XHR upload', async () => {
  const pending = request('/api/v1/users/files/upload', {
    method: 'POST',
    formData: {} as FormData,
    onUploadProgress: jest.fn(),
  });
  const xhr = xhrs[0];
  xhr.responseText = '{"code":10102,"message":"单个文件不能超过 10MB"}';

  xhr.onload?.();

  await expect(pending).rejects.toMatchObject({
    message: '单个文件不能超过 10MB',
    code: 10102,
    status: 200,
  });
});
