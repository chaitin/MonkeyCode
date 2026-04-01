import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import React from 'react';
import themes from '@/utils/terminalThemes';
import { b64decode, b64encode } from '@/utils/common';
import { toast } from 'sonner';

const isWebglSupported = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch (error) {
    return false;
  }
};

interface TerminalProps {
  ws: string
  theme: string
  signal: number
  onTitleChanged: ((env: string) => void) | null
  onUserNameChanged: ((userName: string, userAvatar: string) => void) | null
  onConnectionStatusChanged: ((status: 'connecting' | 'connected' | 'disconnected') => void) | null
}

export default function Terminal({
  ws = '',
  theme = '',
  signal = 0,
  onTitleChanged = null,
  onUserNameChanged = null,
  onConnectionStatusChanged = null,
}: TerminalProps) {
  // 验证 theme 是否为合法值，如果不是则从 localStorage 读取，再不行就设置为 MonkeyCode
  const validTheme = React.useMemo(() => {
    // 如果传入的 theme 是合法值，直接使用
    if (theme && theme in themes) {
      return theme;
    }
    // 否则从 localStorage 读取
    const savedTheme = localStorage.getItem('terminalTheme');
    if (savedTheme && savedTheme in themes) {
      return savedTheme;
    }
    // 最后使用默认值
    return 'MonkeyCode';
  }, [theme]);

  const terminalDiv = React.useRef(null);
  const xtermInstance = React.useRef<XTerm | null>(null);
  const websocketInstance = React.useRef<WebSocket | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const pingLooper = React.useRef<number | null>(null);

  React.useEffect(() => {
    onConnectionStatusChanged?.(connecting ? 'connecting' : connected ? 'connected' : 'disconnected');
  }, [connecting, connected])

  const handleResize = () => {
    if (xtermInstance.current) {
      fitAddonRef.current?.fit();
      // 判断 websocket 是否连接成功（readyState === 1 表示 OPEN 状态）
      if (websocketInstance.current && websocketInstance.current.readyState === 1) {
        websocketInstance.current.send(JSON.stringify({
          type: "resize",
          data: JSON.stringify({
            row: xtermInstance.current?.rows,
            col: xtermInstance.current?.cols
          })
        }));
      }
    }
  };


  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (connected) {
        event.preventDefault();
        event.returnValue = ''; // Chrome 需要设置 returnValue
        return ''; // 其他浏览器
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 使用 ResizeObserver 监听容器大小变化
  React.useEffect(() => {
    if (!terminalDiv.current) return;

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(terminalDiv.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  React.useEffect(() => {
    if (xtermInstance.current) {
       xtermInstance.current.options.theme = { ...themes[validTheme as keyof typeof themes] };
      xtermInstance.current.focus();
    }
  }, [validTheme])

  const resetTerminal = () => {
    if (xtermInstance.current) {
      xtermInstance.current.dispose();
      xtermInstance.current = null;
    }
    if (websocketInstance.current) {
      websocketInstance.current.close();
      websocketInstance.current = null;
    }
    if (pingLooper.current) {
      clearInterval(pingLooper.current);
      pingLooper.current = null;
    }
    setConnecting(false);
    setConnected(false);
  }


  const connectTerminal = async () => {
    if (!ws) {
      return;
    }
    resetTerminal();
    xtermInstance.current = new XTerm({
      allowProposedApi: true,
      theme: themes[validTheme as keyof typeof themes],
      fontFamily: '"Google Sans Code"',
      fontSize: 12,
    });
    
    xtermInstance.current.open(terminalDiv.current as unknown as HTMLElement);
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const unicode11Addon = new Unicode11Addon();
    const webLinksAddon = new WebLinksAddon();
    xtermInstance.current.loadAddon(fitAddon);
    if (isWebglSupported()) {
      const webglAddon = new WebglAddon();
      xtermInstance.current.loadAddon(webglAddon);
    }
    xtermInstance.current.loadAddon(unicode11Addon);
    xtermInstance.current.loadAddon(webLinksAddon);

    fitAddonRef.current.fit();

    xtermInstance.current.onTitleChange((title) => {
      onTitleChanged?.(title);
    });
        
    xtermInstance.current.onData((data) => {
      if (websocketInstance.current && websocketInstance.current.readyState === WebSocket.OPEN) {
        websocketInstance.current.send(JSON.stringify({
          type: "data",
          data: b64encode(data)
        }));
      }
    });

    connectWebSocket();
  }

  const connectWebSocket = () => {
    setConnecting(true);
    
    websocketInstance.current = new WebSocket(ws);
    
    websocketInstance.current.onopen = () => {
      pingLooper.current = window.setInterval(() => {
        if (websocketInstance.current && websocketInstance.current.readyState === WebSocket.OPEN) {
          websocketInstance.current.send(JSON.stringify({ type: "ping" }));
        }
      }, 5000);
    };

    websocketInstance.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'data') {
        const decodedData = b64decode(data.data);
        xtermInstance.current?.write(decodedData);
      } else if (data.type === 'connected') {
        const connectData = JSON.parse(data.data);
        onUserNameChanged?.(connectData.username, connectData.avatar_url || "/logo-colored.png");
        toast.success('终端连接成功');
        setConnecting(false);
        setConnected(true);
        xtermInstance.current?.focus();
        // 等待 DOM 更新后再触发 resize
        requestAnimationFrame(() => {
          handleResize();
        });
      } else if (data.type === 'resize') {
        const { col, row } = JSON.parse(data.data);
        xtermInstance.current?.resize(col, row);
      } else if (data.type === 'error') {
        toast.error(`错误：${data.data}`);
      }
    };

    websocketInstance.current.onclose = (event) => {
      if (websocketInstance.current === event.target) {
        setConnecting(false);
        setConnected(false);
      }
    };

    websocketInstance.current.onerror = (event) => {
      if (websocketInstance.current === event.target) {
        setConnecting(false);
        setConnected(false);
        toast.error('终端连接发生错误');
      }
    };
  }

  React.useEffect(() => {
    if (signal > 0) {
      connectTerminal();
    }
  }, [signal])

  return (
    <div className='h-full w-full p-2 pr-0' style={{
      backgroundColor: themes[validTheme as keyof typeof themes].background,
    }}>
      <div ref={terminalDiv} className='w-full h-full'>
      </div>
    </div>
  )
}
