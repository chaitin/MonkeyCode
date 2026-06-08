/**
 * 实时语音转写（豆包流式 2.0）。
 * 协议见 scripts/test-speech.html / docs/speech-to-text-stream.md：
 *   WS /api/v1/users/tasks/speech-to-text-stream（会话 Cookie 鉴权）
 *   → send {type:'start', format:'pcm', disfluency} → {type:'ready'}
 *   → 流式发送 16kHz / 单声道 / 16-bit PCM 二进制帧
 *   → {type:'partial'|'final', index, text} → send {type:'stop'} → {type:'done'}
 *
 * 麦克风 PCM 实时流依赖原生模块 react-native-live-audio-stream（Expo Go 不含，需 Dev/原生构建）。
 * 因此先判存在再 require，避免在 Expo Go 里 import 即抛错。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { getBaseUrl, openWebSocket } from '@/api/client';

let AudioRecord: {
  init: (o: object) => void;
  start: () => void;
  stop: () => void;
  on: (e: 'data', cb: (b64: string) => void) => { remove: () => void };
} | null = null;
try {
  if (NativeModules.RNLiveAudioStream) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AudioRecord = require('react-native-live-audio-stream').default;
  }
} catch {
  AudioRecord = null;
}

export const SPEECH_AVAILABLE = !!AudioRecord;

export type SpeechStatus = 'idle' | 'connecting' | 'listening' | 'stopping';

const AUDIO_OPTIONS = {
  sampleRate: 16000, // 豆包固定 16kHz
  channels: 1,
  bitsPerSample: 16,
  audioSource: 6, // Android: VOICE_RECOGNITION
  bufferSize: 4096,
};

function speechWsUrl(): string {
  const base = getBaseUrl().replace(/\/+$/, '');
  const ws = base.replace(/^https/i, 'wss').replace(/^http/i, 'ws');
  return `${ws}/api/v1/users/tasks/speech-to-text-stream`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = (globalThis as { atob: (s: string) => string }).atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
        title: '麦克风权限', message: '语音输入需要使用麦克风', buttonPositive: '允许', buttonNegative: '取消',
      });
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }
  return true; // iOS：首次 start 时系统会弹出麦克风授权
}

export function useSpeechToText({ onText, onError }: { onText: (text: string) => void; onError?: (msg: string) => void }) {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const dataSubRef = useRef<{ remove: () => void } | null>(null);
  const recordingRef = useRef(false); // 是否在采集/上行音频
  const emitRef = useRef(false);       // 是否把识别结果写回输入框（停止后用于决定要不要继续接收最终结果）
  const closingRef = useRef(false);    // 是否处于「正常收尾」中：此时 socket 关闭/报错都不算错误
  const sentencesRef = useRef<Map<number, { partial?: string; final?: string }>>(new Map());
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);
  onTextRef.current = onText;
  onErrorRef.current = onError;

  const emitText = useCallback(() => {
    const idxs = [...sentencesRef.current.keys()].sort((a, b) => a - b);
    const text = idxs.map((i) => {
      const s = sentencesRef.current.get(i)!;
      return s.final ?? s.partial ?? '';
    }).join('');
    onTextRef.current(text);
  }, []);

  const stopAudio = useCallback(() => {
    recordingRef.current = false;
    try { AudioRecord?.stop(); } catch { /* noop */ }
    if (dataSubRef.current) { try { dataSubRef.current.remove(); } catch { /* noop */ } dataSubRef.current = null; }
  }, []);

  const cleanup = useCallback(() => {
    emitRef.current = false;
    stopAudio();
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } wsRef.current = null; }
  }, [stopAudio]);

  const fail = useCallback((msg: string) => {
    cleanup();
    setStatus('idle');
    onErrorRef.current?.(msg);
  }, [cleanup]);

  const startAudio = useCallback(() => {
    if (!AudioRecord) { fail('当前版本不支持语音输入'); return; }
    try {
      AudioRecord.init(AUDIO_OPTIONS);
      dataSubRef.current = AudioRecord.on('data', (b64: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !recordingRef.current) return;
        try { ws.send(base64ToBytes(b64).buffer as ArrayBuffer); } catch { /* noop */ }
      });
      AudioRecord.start();
      recordingRef.current = true;
      emitRef.current = true;
      setStatus('listening');
    } catch {
      fail('无法开始录音');
    }
  }, [fail]);

  const start = useCallback(async () => {
    if (!SPEECH_AVAILABLE) { onErrorRef.current?.('语音输入需要重新构建客户端（Expo Go 暂不支持）'); return; }
    if (status !== 'idle') return;
    sentencesRef.current.clear();
    closingRef.current = false;
    emitRef.current = false;
    setStatus('connecting');
    const ok = await ensureMicPermission();
    if (!ok) { setStatus('idle'); onErrorRef.current?.('未获得麦克风权限'); return; }

    let ws: WebSocket;
    // openWebSocket 会带上 Basic Auth 头（用于测试环境的代理鉴权）。
    try { ws = openWebSocket(speechWsUrl()); } catch { fail('无法连接语音服务'); return; }
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: 'start', format: 'pcm', disfluency: false })); } catch { /* noop */ } };
    ws.onmessage = (ev) => {
      let msg: { type?: string; index?: number; text?: string; error?: { message?: string } };
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      switch (msg?.type) {
        case 'ready':
          startAudio();
          break;
        case 'partial': {
          if (!emitRef.current) break; // 已「发送」冻结：别再被迟到的结果覆盖（麦克风停止则仍接收最终结果）
          const s = sentencesRef.current.get(msg.index!) || {};
          s.partial = msg.text || '';
          sentencesRef.current.set(msg.index!, s);
          emitText();
          break;
        }
        case 'final': {
          if (!emitRef.current) break;
          const s = sentencesRef.current.get(msg.index!) || {};
          s.final = msg.text || '';
          delete s.partial;
          sentencesRef.current.set(msg.index!, s);
          emitText();
          break;
        }
        case 'done':
          closingRef.current = true; // 正常结束，后续 socket 关闭不算错误
          cleanup();
          setStatus('idle');
          break;
        case 'error':
          fail(msg?.error?.message || '语音识别出错');
          break;
        default:
          break;
      }
    };
    ws.onerror = () => {
      // 收尾阶段（发了 stop / 收到 done）后端会关闭连接，RN 可能先抛一个 error 事件——此时识别已成功，不应报错。
      if (closingRef.current) { cleanup(); setStatus('idle'); return; }
      fail('语音连接出错');
    };
    ws.onclose = () => {
      stopAudio();
      wsRef.current = null;
      setStatus((s) => (s === 'idle' ? s : 'idle'));
    };
  }, [status, startAudio, emitText, cleanup, stopAudio, fail]);

  // discard=true（点发送）：立即冻结输入框，迟到的识别结果不再覆盖；
  // discard=false（点麦克风）：停止采集但继续接收，直到拿到 done 的最终结果。
  const stop = useCallback((discard = false) => {
    if (status === 'idle') return;
    setStatus('stopping');
    closingRef.current = true;
    if (discard) emitRef.current = false;
    stopAudio();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'stop' })); } catch { /* noop */ }
      // 等 done；2.5s 兜底强制收尾
      setTimeout(() => { if (wsRef.current === ws) { cleanup(); setStatus('idle'); } }, 2500);
    } else {
      cleanup();
      setStatus('idle');
    }
  }, [status, stopAudio, cleanup]);

  const toggle = useCallback(() => { if (status === 'idle') start(); else stop(false); }, [status, start, stop]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, toggle, stop, active: status !== 'idle', available: SPEECH_AVAILABLE };
}
