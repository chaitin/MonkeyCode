/**
 * 语音转写流程集成测试：用 mock 的原生音频模块 + WebSocket 驱动真实的 useSpeechToText，
 * 验证「点麦克风 → 连接 → ready → 上行音频帧 → 服务端 partial/final → 文本写回输入框 → 再点停止」。
 * （真实麦克风采集是硬件，无法在 CI 里跑；这里覆盖我们掌控的全部 JS 逻辑。）
 * 注：jest.mock 工厂只能引用以 mock 开头的变量，故命名为 mockAudio / MockWS。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// 1) mock 原生音频模块，捕获 'data' 回调
const mockAudio: any = {
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  _dataCb: null as null | ((b64: string) => void),
  on: jest.fn((_evt: string, cb: (b64: string) => void) => {
    mockAudio._dataCb = cb;
    return { remove: jest.fn() };
  }),
};
jest.mock('react-native-live-audio-stream', () => ({ __esModule: true, default: mockAudio }));

// 2) mock react-native：只用到 NativeModules / PermissionsAndroid / Platform
jest.mock('react-native', () => ({
  NativeModules: { RNLiveAudioStream: {} }, // 让模块级守卫为真 → 走原生路径
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'rec' },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn().mockResolvedValue('granted'),
  },
  Platform: { OS: 'ios' },
}));

// 3) 可控的假 WebSocket
class MockWS {
  static OPEN = 1;
  static last: MockWS | null = null;
  url: string;
  readyState = 0;
  binaryType = '';
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  sent: any[] = [];
  constructor(url: string) { this.url = url; MockWS.last = this; }
  send(d: any) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose && this.onclose({}); }
}

// 4) mock api/client：openWebSocket 返回假 WS
jest.mock('@/api/client', () => ({
  getBaseUrl: () => 'https://test.local',
  openWebSocket: (url: string) => new MockWS(url),
}));

(global as any).WebSocket = MockWS;

// 在 mock 就绪后再加载 hook（模块级守卫此时看到 NativeModules.RNLiveAudioStream）
const { useSpeechToText } = require('../useSpeechToText');

// 极简 renderHook（hook 不渲染任何宿主组件，react-test-renderer 即可）
function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result: { current: T } = { current: undefined as any };
  function Probe() { result.current = hook(); return null; }
  act(() => { TestRenderer.create(React.createElement(Probe)); });
  return { result };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

test('mic toggle streams server transcription into onText and stops on second tap', async () => {
  const texts: string[] = [];
  const errors: string[] = [];
  const { result } = renderHook(() =>
    useSpeechToText({ onText: (t: string) => texts.push(t), onError: (m: string) => errors.push(m) }),
  );

  expect(result.current.available).toBe(true);

  // 点麦克风 → 连接
  await act(async () => { result.current.toggle(); });
  await flush();
  const ws = MockWS.last!;
  expect(ws).toBeTruthy();

  // WS 打开 → 发送 start
  await act(async () => { ws.readyState = 1; ws.onopen && ws.onopen({}); });
  expect(ws.sent[0]).toContain('"type":"start"');

  // 服务端 ready → 开始采集
  await act(async () => { ws.onmessage && ws.onmessage({ data: JSON.stringify({ type: 'ready' }) }); });
  expect(mockAudio.start).toHaveBeenCalled();
  expect(result.current.status).toBe('listening');

  // 麦克风产生 PCM → 以二进制上行
  const before = ws.sent.length;
  await act(async () => { mockAudio._dataCb && mockAudio._dataCb(Buffer.from('abcd').toString('base64')); });
  expect(ws.sent.length).toBeGreaterThan(before);

  // 服务端流式返回 → onText 累积
  await act(async () => { ws.onmessage!({ data: JSON.stringify({ type: 'partial', index: 0, text: '你好' }) }); });
  await act(async () => { ws.onmessage!({ data: JSON.stringify({ type: 'final', index: 0, text: '你好世界' }) }); });
  expect(texts[texts.length - 1]).toBe('你好世界');

  // 再点一次 → 停止
  await act(async () => { result.current.stop(false); });
  expect(ws.sent.some((m: any) => typeof m === 'string' && m.includes('"type":"stop"'))).toBe(true);

  // 服务端 done → 回到 idle，且全程没有报错
  await act(async () => { ws.onmessage!({ data: JSON.stringify({ type: 'done' }) }); });
  expect(result.current.status).toBe('idle');
  expect(errors).toEqual([]);
});
