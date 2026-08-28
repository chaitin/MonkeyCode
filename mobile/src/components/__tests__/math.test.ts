import MarkdownIt from 'markdown-it';
import { loadMathJax, mathPlugin, mathWithinRenderBudget, subscribeMathJaxReady, texToSvg } from '../math';

const md = new MarkdownIt({ typographer: true }).use(mathPlugin as any);

type Token = { type: string; content: string; meta?: { display?: boolean } | null; children?: Token[] | null };

function tokens(src: string): Token[] {
  const flat: Token[] = [];
  for (const token of md.parse(src, {}) as Token[]) {
    flat.push(token);
    if (token.children) flat.push(...token.children);
  }
  return flat;
}

function mathTokens(src: string): Token[] {
  return tokens(src).filter((t) => t.type === 'math_inline' || t.type === 'math_block');
}

test('tokenizes multi-line $$ and \\[ blocks as math_block', () => {
  const dollar = mathTokens('前文\n\n$$\nE = mc^2\n$$\n\n后文');
  expect(dollar).toHaveLength(1);
  expect(dollar[0].type).toBe('math_block');
  expect(dollar[0].content).toBe('E = mc^2');

  const bracket = mathTokens('\\[\n\\frac{a}{b}\n\\]');
  expect(bracket).toHaveLength(1);
  expect(bracket[0].type).toBe('math_block');
  expect(bracket[0].content).toBe('\\frac{a}{b}');
});

test('unclosed $$ block stays plain text (streaming tail)', () => {
  expect(mathTokens('$$\nE = mc^2')).toHaveLength(0);
});

test('tokenizes inline $…$ with boundary guards', () => {
  const found = mathTokens('质能方程 $E=mc^2$ 很有名');
  expect(found).toHaveLength(1);
  expect(found[0].type).toBe('math_inline');
  expect(found[0].content).toBe('E=mc^2');
  expect(found[0].meta?.display).toBe(false);

  // 货币等场景不误判：闭合 $ 后面跟数字/字母、开头跟空格都不成立。
  expect(mathTokens('价格是 $5，成本 $3')).toHaveLength(0);
  expect(mathTokens('花了 $5 和 $6 两笔')).toHaveLength(0);
  expect(mathTokens('$ x $')).toHaveLength(0);
});

test('tokenizes single-line $$…$$ as inline display math', () => {
  const found = mathTokens('推导得 $$x = \\frac{1}{2}$$，代入即可');
  expect(found).toHaveLength(1);
  expect(found[0].type).toBe('math_inline');
  expect(found[0].content).toBe('x = \\frac{1}{2}');
  expect(found[0].meta?.display).toBe(true);
});

test('tokenizes \\(…\\) and \\[…\\] before the escape rule eats them', () => {
  const paren = mathTokens('其中 \\(\\alpha + \\beta\\) 为常数');
  expect(paren).toHaveLength(1);
  expect(paren[0].content).toBe('\\alpha + \\beta');
  expect(paren[0].meta?.display).toBe(false);

  const bracket = mathTokens('结论：\\[x^2 + y^2 = z^2\\]');
  expect(bracket).toHaveLength(1);
  expect(bracket[0].meta?.display).toBe(true);
});

test('math inside fenced code is untouched', () => {
  expect(mathTokens('```\n$E=mc^2$\n```')).toHaveLength(0);
  expect(mathTokens('行内代码 `$x$` 保持原样')).toHaveLength(0);
});

test('render budget rejects oversized sources and macro definitions', () => {
  expect(mathWithinRenderBudget('x^2')).toBe(true);
  expect(mathWithinRenderBudget('x'.repeat(513))).toBe(false);
  expect(mathWithinRenderBudget('\\def\\x{y}')).toBe(false);
  expect(mathWithinRenderBudget('\\newcommand{\\f}{g}')).toBe(false);
});

test('texToSvg converts TeX to sized SVG after loadMathJax', async () => {
  expect(texToSvg('x^2', false, 14.5)).toBeNull(); // 未加载时回退

  // 订阅者在就绪时收到一次通知（触发全体公式组件的单次批量重渲）。
  const notified = jest.fn();
  const unsubscribe = subscribeMathJaxReady(notified);
  expect(notified).not.toHaveBeenCalled();
  await loadMathJax();
  expect(notified).toHaveBeenCalledTimes(1);
  unsubscribe();

  const inline = texToSvg('x^2', false, 14.5);
  expect(inline?.svg).toContain('<svg');
  expect(inline?.width).toBeGreaterThan(0);
  expect(inline?.height).toBeGreaterThan(0);

  const block = texToSvg('\\frac{a}{b}', true, 16);
  expect(block?.svg).toContain('<svg');
  expect(block?.depth).toBeGreaterThan(0); // 分式向基线下方延伸

  // 超预算直接拒绝，不进 MathJax。
  expect(texToSvg('x'.repeat(513), true, 16)).toBeNull();

  // 缓存命中返回一致结果。
  expect(texToSvg('x^2', false, 14.5)).toEqual(inline);
});
