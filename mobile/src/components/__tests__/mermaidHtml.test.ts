import { buildMermaidHtml, fenceLanguage, trimFenceContent } from '../mermaidHtml';

const theme = {
  acGhost: 'rgba(22,179,100,0.11)',
  acTx: '#0b8f4d',
  bg2: '#ffffff',
  dark: false,
  line2: 'rgba(20,20,16,0.10)',
  tx: '#1d1d1a',
};

const runtime = 'window.mermaid = { initialize() {}, async render() { return { svg: "<svg></svg>" }; } };';

test('fenceLanguage detects mermaid from markdown-display sourceInfo', () => {
  expect(fenceLanguage({ sourceInfo: 'mermaid' })).toBe('mermaid');
  expect(fenceLanguage({ sourceInfo: ' Mermaid title=flow ' })).toBe('mermaid');
  expect(fenceLanguage({ info: 'ts' })).toBe('ts');
});

test('trimFenceContent removes only the parser-added trailing newline', () => {
  expect(trimFenceContent('graph TD\nA-->B\n')).toBe('graph TD\nA-->B');
  expect(trimFenceContent('graph TD\nA-->B')).toBe('graph TD\nA-->B');
});

test('buildMermaidHtml keeps diagram text in JS data and escapes closing script tags', () => {
  const code = 'graph TD\nA["</script><script>alert(1)</script>"]-->B';
  const html = buildMermaidHtml(code, theme, runtime);

  expect(html).toContain('window.__mermaidDiagram = ');
  expect(html).toContain('<\\/script>');
  expect(html).toContain('pre.textContent = window.__mermaidDiagram.trimEnd()');
  expect(html).not.toContain('A["</script><script>alert(1)</script>"]');
});

test('buildMermaidHtml inlines and escapes the local mermaid runtime', () => {
  const runtimeWithEndTag = 'window.__runtimeLoaded = "</script>";';
  const html = buildMermaidHtml('graph TD\nA-->B', theme, runtimeWithEndTag);

  expect(html).toContain('window.__runtimeLoaded = "<\\/script>";');
  expect(html).not.toContain('window.__runtimeLoaded = "</script>";');
  expect(html.indexOf('window.__runtimeLoaded')).toBeLessThan(html.indexOf('window.mermaid.initialize'));
});
