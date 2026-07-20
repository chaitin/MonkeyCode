const mockFetch = jest.fn();

import { request } from '../client';

beforeAll(() => {
  (global as any).fetch = mockFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
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
