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
import { useTranslation } from 'react-i18next';

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

const buildWebSocketUrl = (rawUrl: string): string => {
  if (!rawUrl) {
    return rawUrl;
  }

  if (rawUrl.startsWith('ws://') || rawUrl.startsWith('wss://')) {
    return rawUrl;
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    const normalized = new URL(rawUrl);
    normalized.protocol = normalized.protocol === 'https:' ? 'wss:' : 'ws:';
    return normalized.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
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
  const { t } = useTranslation();

  // Validate the theme, then fall back to localStorage and the default theme.
  const validTheme = React.useMemo(() => {
    if (theme && theme in themes) {
      return theme;
    }
    const savedTheme = localStorage.getItem('terminalTheme');
    if (savedTheme && savedTheme in themes) {
      return savedTheme;
    }
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
      // readyState 1 means the websocket is open.
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
        event.returnValue = ''; // Chrome requires returnValue.
        return ''; // Other browsers.
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Watch container size changes with ResizeObserver.
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
      if (xtermInstance.current.rows > 0) {
        xtermInstance.current.refresh(0, xtermInstance.current.rows - 1);
      }
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
      fontFamily: '"JetBrains Mono Variable", monospace',
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
    
    websocketInstance.current = new WebSocket(buildWebSocketUrl(ws));
    
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
        onUserNameChanged?.(connectData.username, connectData.avatar_url || "/logo-light.png");
        toast.success(t("common.terminal.connected"));
        setConnecting(false);
        setConnected(true);
        xtermInstance.current?.focus();
        // Trigger resize after the DOM has updated.
        requestAnimationFrame(() => {
          handleResize();
        });
      } else if (data.type === 'resize') {
        const { col, row } = JSON.parse(data.data);
        xtermInstance.current?.resize(col, row);
      } else if (data.type === 'error') {
        toast.error(t("common.terminal.serverError", { message: data.data }));
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
        toast.error(t("common.terminal.connectionError"));
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
