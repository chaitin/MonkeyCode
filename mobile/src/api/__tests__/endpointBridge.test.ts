const mockOpenWebSocket = jest.fn();

jest.mock('../client', () => ({
  getBaseUrl: () => 'https://api.example.test',
  openWebSocket: (...args: unknown[]) => mockOpenWebSocket(...args),
}));

jest.mock('react-native-quick-crypto', () => ({
  randomUUID: () => '55555555-5555-4555-8555-555555555555',
}));

import { EndpointBridgeClient, type EndpointProfile } from '../endpointBridge';

class MockSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send = jest.fn();
  close = jest.fn();
}

const machineId = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const profile: EndpointProfile = {
  device_name: '测试手机',
  platform: 'ios',
  os_version: '18.0',
  arch: 'arm64',
  client_version: 'test',
};

beforeAll(() => {
  (global as any).WebSocket = { OPEN: 1 };
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test('连接后握手并用全量快照替换端点目录', () => {
  const socket = new MockSocket();
  mockOpenWebSocket.mockReturnValue(socket);
  const onDirectory = jest.fn();
  const client = new EndpointBridgeClient({
    machineId,
    profile,
    onDirectory,
    idFactory: () => '33333333-3333-4333-8333-333333333333',
  });

  client.connect();
  socket.readyState = 1;
  socket.onopen?.();

  expect(mockOpenWebSocket).toHaveBeenCalledWith('wss://api.example.test/api/v1/endpoints/connect');
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
    type: 'hello',
    protocol_versions: [1],
    machine_id: machineId,
    profile,
  });

  socket.onmessage?.({ data: JSON.stringify({ type: 'welcome', protocol_version: 1 }) });
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'directory.snapshot',
      endpoints: [{ machine_id: target, display_name: '电脑' }],
    }),
  });
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'directory.snapshot',
      endpoints: [{ machine_id: machineId, display_name: '手机' }],
    }),
  });

  expect(onDirectory).toHaveBeenLastCalledWith([{ machine_id: machineId, display_name: '手机' }]);
  expect(client.endpoints).toEqual([{ machine_id: machineId, display_name: '手机' }]);
  client.disconnect();
});

test('请求只接受目标端点的关联响应', async () => {
  const socket = new MockSocket();
  mockOpenWebSocket.mockReturnValue(socket);
  const ids = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const client = new EndpointBridgeClient({
    machineId,
    profile,
    idFactory: () => ids.shift()!,
  });
  client.connect();
  socket.readyState = 1;
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify({ type: 'welcome', protocol_version: 1 }) });

  const pending = client.request(target, 'agent.continue', { task_id: 'task-1' });
  const outbound = JSON.parse(socket.send.mock.calls[1][0]);
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'response',
      message_id: ids[0],
      source: machineId,
      target: machineId,
      reply_to: outbound.message_id,
      routed_at: Date.now(),
      payload: { ignored: true },
    }),
  });
  let settled = false;
  void pending.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  socket.onmessage?.({
    data: JSON.stringify({
      type: 'response',
      message_id: ids[0],
      source: target,
      target: machineId,
      reply_to: outbound.message_id,
      routed_at: Date.now(),
      payload: { result: 'ok' },
    }),
  });
  await expect(pending).resolves.toEqual({ result: 'ok' });
  client.disconnect();
});

test('超时和断线均以 outcome_unknown 结束 pending 且不自动重发', async () => {
  const socket = new MockSocket();
  mockOpenWebSocket.mockReturnValue(socket);
  const client = new EndpointBridgeClient({
    machineId,
    profile,
    idFactory: () => '33333333-3333-4333-8333-333333333333',
  });
  client.connect();
  socket.readyState = 1;
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify({ type: 'welcome', protocol_version: 1 }) });

  const timedOut = client.request(target, 'agent.continue', {}, 1000);
  jest.advanceTimersByTime(1000);
  await expect(timedOut).rejects.toMatchObject({ code: 'outcome_unknown' });

  const disconnected = client.request(target, 'agent.continue', {});
  socket.onclose?.({ code: 4001 });
  await expect(disconnected).rejects.toMatchObject({ code: 'outcome_unknown' });
  expect(socket.send).toHaveBeenCalledTimes(3);
});
