const mockGetDocumentAsync = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockUploadAsync = jest.fn();
const mockRequest = jest.fn();
const mockFetch = jest.fn();
let mockPlatformOS = 'ios';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args),
}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-media-library', () => ({}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockPlatformOS; } },
}));
jest.mock('../client', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
}));

import { pickWorkspaceFile, pickZipFile, uploadFileWithPresignedUrl, uploadWorkspaceFile } from '../upload';

class MockFormData {
  entries: [string, unknown][] = [];
  append(name: string, value: unknown) { this.entries.push([name, value]); }
}

class MockXHR {
  responseType = '';
  response: ArrayBuffer = new Uint8Array([1, 2, 3]).buffer;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open = jest.fn();
  send = jest.fn(() => this.onload?.());
}

beforeAll(() => {
  (global as any).XMLHttpRequest = MockXHR;
  (global as any).fetch = mockFetch;
  (global as any).FormData = MockFormData;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPlatformOS = 'ios';
});

test('pickZipFile reuses an in-progress native document picker', async () => {
  let resolvePick!: (value: { canceled: true }) => void;
  mockGetDocumentAsync.mockReturnValueOnce(new Promise((resolve) => { resolvePick = resolve; }));

  const first = pickZipFile();
  const second = pickZipFile();

  expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1);
  resolvePick({ canceled: true });
  await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
});

test('pickZipFile converts the native concurrent-picker error', async () => {
  mockGetDocumentAsync.mockRejectedValueOnce(
    new Error("Calling the 'getDocumentAsync' function has failed: Different document picking in progress"),
  );

  await expect(pickZipFile()).rejects.toThrow('文件选择器状态异常，请重新打开 App 后重试');
});

test('pickZipFile rejects a zip whose size cannot be read', async () => {
  mockGetDocumentAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///cache/project.zip', name: 'project.zip' }],
  });
  mockGetInfoAsync.mockResolvedValueOnce({ exists: true });

  await expect(pickZipFile()).rejects.toThrow('无法读取 zip 文件大小，请重新选择');
});

test('pickWorkspaceFile accepts any document up to 10MB', async () => {
  mockGetDocumentAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///cache/spec.pdf', name: 'spec.pdf', mimeType: 'application/pdf', size: 4096 }],
  });

  await expect(pickWorkspaceFile()).resolves.toEqual({
    uri: 'file:///cache/spec.pdf',
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    size: 4096,
  });
  expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: '*/*', multiple: false }));
});

test('pickWorkspaceFile accepts an empty document', async () => {
  mockGetDocumentAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///cache/empty.txt', name: 'empty.txt', mimeType: 'text/plain', size: 0 }],
  });

  await expect(pickWorkspaceFile()).resolves.toEqual({
    uri: 'file:///cache/empty.txt',
    name: 'empty.txt',
    mimeType: 'text/plain',
    size: 0,
  });
  expect(mockGetInfoAsync).not.toHaveBeenCalled();
});

test('pickWorkspaceFile rejects a document larger than 10MB', async () => {
  mockGetDocumentAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///cache/large.bin', name: 'large.bin', size: 10 * 1024 * 1024 + 1 }],
  });

  await expect(pickWorkspaceFile()).rejects.toThrow('单个文件不能超过 10MB');
});

test('uploadWorkspaceFile sends the picked file as multipart form data', async () => {
  mockRequest.mockResolvedValueOnce({ code: 0 });
  const controller = new AbortController();

  await uploadWorkspaceFile('vm-1', '/workspace/docs/spec.pdf', {
    uri: 'file:///cache/spec.pdf',
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    size: 4096,
  }, controller.signal);

  expect(mockRequest).toHaveBeenCalledWith('/api/v1/users/files/upload', expect.objectContaining({
    method: 'POST',
    query: { id: 'vm-1', path: '/workspace/docs/spec.pdf' },
    formData: expect.any(MockFormData),
    signal: controller.signal,
  }));
  const form = mockRequest.mock.calls[0][1].formData as MockFormData;
  expect(form.entries).toEqual([['file', {
    uri: 'file:///cache/spec.pdf',
    name: 'spec.pdf',
    type: 'application/pdf',
  }]]);
});

test('uploadFileWithPresignedUrl PUTs the file without signed headers', async () => {
  mockRequest.mockResolvedValueOnce({
    data: { upload_url: 'https://oss.example.test/signed', access_url: '/api/v1/assets?key=test' },
  });
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue('') });

  await expect(uploadFileWithPresignedUrl({
    uri: 'file:///cache/project.zip',
    name: 'project.zip',
  })).resolves.toEqual({ url: '/api/v1/assets?key=test', filename: 'project.zip' });

  expect(mockFetch).toHaveBeenCalledWith(
    'https://oss.example.test/signed',
    expect.objectContaining({
      method: 'PUT',
      body: expect.any(ArrayBuffer),
      credentials: 'omit',
    }),
  );
  expect(mockFetch.mock.calls[0][1]).not.toHaveProperty('headers');
});

test('uploadFileWithPresignedUrl reports the OSS error details', async () => {
  mockRequest.mockResolvedValueOnce({
    data: { upload_url: 'https://oss.example.test/signed', access_url: '/unused' },
  });
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 403,
    text: jest.fn().mockResolvedValue(
      '<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>',
    ),
  });

  await expect(uploadFileWithPresignedUrl({
    uri: 'file:///cache/project.zip',
    name: 'project.zip',
  })).rejects.toThrow('上传失败（403 SignatureDoesNotMatch：bad signature）');
});

test('uploadFileWithPresignedUrl uses headerless native binary upload on Android', async () => {
  mockPlatformOS = 'android';
  mockRequest.mockResolvedValueOnce({
    data: { upload_url: 'https://oss.example.test/signed', access_url: '/api/v1/assets?key=test' },
  });
  mockUploadAsync.mockResolvedValueOnce({ status: 200, body: '', headers: {} });

  await expect(uploadFileWithPresignedUrl({
    uri: 'file:///cache/project.zip',
    name: 'project.zip',
  })).resolves.toEqual({ url: '/api/v1/assets?key=test', filename: 'project.zip' });

  expect(mockUploadAsync).toHaveBeenCalledWith(
    'https://oss.example.test/signed',
    'file:///cache/project.zip',
    { httpMethod: 'PUT', uploadType: 0 },
  );
  expect(mockFetch).not.toHaveBeenCalled();
});
