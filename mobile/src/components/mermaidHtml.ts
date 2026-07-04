import type { Theme } from '@/theme';

type MermaidTheme = Pick<Theme, 'acGhost' | 'acTx' | 'bg2' | 'dark' | 'line2' | 'tx'>;

function escapeScriptContent(script: string): string {
  return script.replace(/<\/script/gi, '<\\/script');
}

export function trimFenceContent(content: unknown): string {
  const text = typeof content === 'string' ? content : '';
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function fenceLanguage(node: { sourceInfo?: string; info?: string }): string {
  return String(node.sourceInfo ?? node.info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

export function buildMermaidHtml(code: string, t: MermaidTheme, mermaidRuntime: string): string {
  const diagramJson = JSON.stringify(code).replace(/<\//g, '<\\/');
  const runtime = escapeScriptContent(mermaidRuntime);
  const bg = t.bg2;
  const fg = t.tx;
  const line = t.line2;
  const accent = t.acTx;
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    html, body { margin: 0; padding: 0; background: ${bg}; color: ${fg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }
    #wrap { box-sizing: border-box; padding: 12px; border: 1px solid ${line}; border-radius: 12px; background: ${bg}; }
    #graph { width: 100%; overflow: hidden; }
    #graph svg { display: block; width: 100%; max-width: 100%; height: auto; }
    #fallback { white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 18px; color: ${fg}; }
  </style>
</head>
<body>
  <div id="wrap"><div id="graph"></div></div>
  <script>
    window.__mermaidDiagram = ${diagramJson};
    window.__mermaidFailed = false;
    window.__mermaidPost = (type, value) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type, value }));
    window.__mermaidReportHeight = () => {
      const wrap = document.getElementById('wrap');
      window.__mermaidPost('height', Math.ceil((wrap && wrap.getBoundingClientRect().height) || document.documentElement.scrollHeight || document.body.scrollHeight || 80));
    };
    window.__mermaidFail = () => {
      if (window.__mermaidFailed) return;
      window.__mermaidFailed = true;
      const pre = document.createElement('pre');
      pre.id = 'fallback';
      pre.textContent = window.__mermaidDiagram.trimEnd();
      const graph = document.getElementById('graph');
      graph.innerHTML = '';
      graph.appendChild(pre);
      window.__mermaidReportHeight();
      window.__mermaidPost('error', true);
    };
    window.addEventListener('error', window.__mermaidFail);
    window.addEventListener('unhandledrejection', window.__mermaidFail);
  </script>
  <script>
${runtime}
  </script>
  <script>
    (async () => {
      try {
        if (!window.mermaid) throw new Error('mermaid unavailable');
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: ${t.dark ? "'dark'" : "'base'"},
          themeVariables: {
            primaryColor: '${t.acGhost}',
            primaryTextColor: '${fg}',
            primaryBorderColor: '${accent}',
            lineColor: '${accent}',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }
        });
        const result = await window.mermaid.render('mmd-' + Date.now(), window.__mermaidDiagram);
        document.getElementById('graph').innerHTML = result.svg;
        requestAnimationFrame(window.__mermaidReportHeight);
        setTimeout(window.__mermaidReportHeight, 100);
      } catch (e) {
        window.__mermaidFail();
      }
    })();
  </script>
</body>
</html>`;
}
