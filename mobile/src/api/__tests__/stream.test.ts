const mockOpenWebSocket = jest.fn();

jest.mock('../client', () => ({
  getBaseUrl: () => 'https://api.example.test',
  openWebSocket: (...args: unknown[]) => mockOpenWebSocket(...args),
}));

import { TaskStreamClient } from '../stream';

class MockSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
}

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

test('queued question reply reports sent after reconnect flushes it', () => {
  const first = new MockSocket();
  const second = new MockSocket();
  mockOpenWebSocket.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const onReplyStatus = jest.fn();
  const client = TaskStreamClient.attach('task-1', { onReplyStatus });

  client.connect();
  first.onclose?.();
  expect(client.sendReplyQuestion('ask-1', { answer: 'yes' })).toBe('queued');
  expect(onReplyStatus).toHaveBeenLastCalledWith('ask-1', 'queued');

  jest.advanceTimersByTime(500);
  second.readyState = 1;
  second.onopen?.();

  expect(second.send).toHaveBeenCalledTimes(1);
  expect(onReplyStatus).toHaveBeenLastCalledWith('ask-1', 'sent');
  client.disconnect();
});
