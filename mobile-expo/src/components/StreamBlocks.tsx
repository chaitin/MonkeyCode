/**
 * Agent 活动流的消息块渲染 —— 对齐设计稿 screen-chat.jsx。
 * 复用 messages/handler 的 ChatMessage 类型（user / agent / thought / tool / error / system / ask）。
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { AskQuestion, ChatMessage } from '@/messages/handler';
import { Icons, Spinner } from '@/components/Icons';
import { useTheme, type Theme } from '@/theme';

export type AnswerMap = Record<string, string | string[]>;

function mdStyles(t: Theme) {
  return {
    body: { color: t.tx, fontSize: 14.5, lineHeight: 23 },
    paragraph: { color: t.tx, fontSize: 14.5, lineHeight: 23, marginTop: 0, marginBottom: 8 },
    heading1: { color: t.tx, fontSize: 20, fontWeight: '700', marginVertical: 6 },
    heading2: { color: t.tx, fontSize: 17, fontWeight: '700', marginVertical: 5 },
    heading3: { color: t.tx, fontSize: 15, fontWeight: '700', marginVertical: 4 },
    strong: { color: t.tx, fontWeight: '700' },
    em: { color: t.tx, fontStyle: 'italic' },
    link: { color: t.acTx },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { color: t.tx, marginVertical: 1 },
    code_inline: { color: t.acTx, backgroundColor: t.bg3, borderRadius: 5, paddingHorizontal: 5, fontFamily: 'monospace', fontSize: 13 },
    code_block: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    fence: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    blockquote: { backgroundColor: t.bg3, borderColor: t.line2, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    hr: { backgroundColor: t.line2, height: 1 },
  } as const;
}

function toolIcon(kind?: string): string {
  switch (kind) {
    case 'read': return 'file';
    case 'edit': return 'edit';
    case 'create': return 'filePlus';
    case 'delete': case 'move': return 'file';
    case 'execute': return 'terminal';
    case 'search': return 'search';
    case 'fetch': return 'search';
    case 'think': return 'brain';
    default: return 'cube';
  }
}

function ThoughtBlock({ text, t, onCopy }: { text: string; t: Theme; onCopy?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} onLongPress={() => onCopy?.(text)} style={{ paddingVertical: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icons.brain size={14} color={t.tx3} sw={1.6} />
        <Text style={{ color: t.tx3, fontSize: 12.5, fontWeight: '500' }}>思考过程</Text>
        <Icons.chevron size={13} color={t.tx3} sw={1.9} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </View>
      {open ? <Text style={{ marginTop: 7, paddingLeft: 21, color: t.tx3, fontSize: 13, lineHeight: 20, fontStyle: 'italic' }}>{text}</Text> : null}
    </Pressable>
  );
}

// ── 错误块：默认折叠（最多 6 行），完整错误可能很长（堆栈）→ 点击展开 / 长按复制 ──────
function ErrorBlock({ text, t, onCopy }: { text: string; t: Theme; onCopy?: (s: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 200 || text.split('\n').length > 6;
  return (
    <Pressable onPress={long ? () => setExpanded((v) => !v) : undefined} onLongPress={() => onCopy?.(text)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: t.redGhost, borderWidth: 1, borderColor: t.red, borderRadius: 13, padding: 12 }}>
      <Icons.alert size={16} color={t.red} sw={1.9} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={long && !expanded ? 6 : undefined} style={{ color: t.red, fontSize: 13.5, lineHeight: 20 }}>{text}</Text>
        {long ? <Text style={{ color: t.red, opacity: 0.75, fontSize: 11.5, fontWeight: '700', marginTop: 7 }}>{expanded ? '收起' : '展开完整错误'} · 长按复制</Text> : null}
      </View>
    </Pressable>
  );
}

// ── 工具调用卡片：两行（动作 + 目标）+ 点击展开详情（对齐 web message-toolcall）──────
type ToolMsg = Extract<ChatMessage, { kind: 'tool' }>;

const cleanStr = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim() : '');

/** 动作名：按 ACP kind；编辑类随状态变化；未知 kind 回退到中文短标题或「工具调用」。 */
function toolAction(m: ToolMsg): string {
  const editing = m.status === 'failed' ? '修改文件失败'
    : (m.status === 'pending' || m.status === 'in_progress') ? '正在修改文件' : '修改文件';
  switch (m.toolKind) {
    case 'edit': return editing;
    case 'read': return '读取文件';
    case 'execute': return '执行命令';
    case 'search': return '查找内容';
    case 'fetch': return '获取网页';
    case 'delete': return '删除文件';
    case 'move': return '移动文件';
    case 'think': return '思考';
    default:
      if (typeof m.title === 'string' && m.title.length < 24 && /[一-龥]/.test(m.title)) return m.title;
      return '工具调用';
  }
}

/** 目标：文件路径 / 命令 / 关键词 / URL。 */
function toolTarget(m: ToolMsg): string {
  const ri = m.rawInput ?? {};
  const path = cleanStr(ri.file_path ?? ri.filePath ?? ri.path);
  if (path) return path;
  if (typeof ri.command === 'string') return cleanStr(ri.command);
  if (Array.isArray(ri.command) && ri.command.length) return cleanStr(ri.command[ri.command.length - 1]);
  if (ri.parsed_cmd?.[0]?.cmd) return cleanStr(ri.parsed_cmd[0].cmd);
  if (ri.pattern) return cleanStr(ri.pattern);
  if (ri.url) return cleanStr(ri.url);
  if (ri.query) return cleanStr(ri.query);
  return '';
}

/** 展开详情：编辑 diff / 命令输出 / 文件内容 / 兜底原始入参。 */
function toolDetail(m: ToolMsg): string {
  const ri = m.rawInput ?? {};
  const ro = m.rawOutput ?? {};
  if (m.toolKind === 'edit') {
    const oldS = typeof ri.old_string === 'string' ? ri.old_string : '';
    const newS = typeof (ri.new_string ?? ri.content) === 'string' ? (ri.new_string ?? ri.content) : '';
    const minus = oldS ? oldS.split('\n').map((l: string) => '- ' + l).join('\n') : '';
    const plus = newS ? newS.split('\n').map((l: string) => '+ ' + l).join('\n') : '';
    const diff = [minus, plus].filter(Boolean).join('\n');
    if (diff) return diff;
  }
  let out = '';
  if (typeof ro.output === 'string') out = ro.output;
  else {
    if (typeof ro.stdout === 'string') out += ro.stdout;
    if (typeof ro.stderr === 'string' && ro.stderr) out += (out ? '\n' : '') + ro.stderr;
  }
  if (!out && Array.isArray(m.content) && m.content[0]?.content?.text) out = String(m.content[0].content.text);
  if (!out && typeof m.content === 'string') out = m.content;
  if (m.toolKind === 'execute') {
    const cmd = typeof ri.command === 'string' ? ri.command
      : Array.isArray(ri.command) ? ri.command[ri.command.length - 1]
      : (ri.parsed_cmd?.[0]?.cmd ?? '');
    return `$ ${cmd}\n${out || '（命令输出为空）'}`.trim();
  }
  if (out) return out;
  try { return Object.keys(ri).length ? JSON.stringify(ri, null, 2) : ''; } catch { return ''; }
}

function ToolCard({ msg, t, onCopy }: { msg: ToolMsg; t: Theme; onCopy?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const I = Icons[toolIcon(msg.toolKind)] ?? Icons.cube;
  const running = msg.status === 'in_progress' || msg.status === 'pending';
  const failed = msg.status === 'failed';
  const action = toolAction(msg);
  const target = toolTarget(msg);
  const detail = toolDetail(msg);
  const canExpand = !running && detail.trim().length > 0;
  const isEdit = msg.toolKind === 'edit';
  const copyText = detail || [action, target].filter(Boolean).join(' ');

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line, borderRadius: 13, overflow: 'hidden' }}>
      <Pressable onPress={() => { if (canExpand) setOpen((o) => !o); }} onLongPress={() => onCopy?.(copyText)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
          <I size={15} color={failed ? t.red : t.acTx} sw={1.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: failed ? t.red : t.tx }}>{action}</Text>
          {target ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, fontFamily: 'monospace', marginTop: 1.5 }}>{target}</Text> : null}
        </View>
        {running ? <Spinner size={15} color={t.acTx} sw={2} />
          : failed ? <Icons.alert size={15} color={t.red} sw={2} />
          : <Icons.check size={16} color={t.acTx} sw={2.4} />}
        {canExpand ? <Icons.chevron size={13} color={t.tx3} sw={2} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} /> : null}
      </Pressable>
      {open && canExpand ? (
        <View style={{ borderTopWidth: 1, borderColor: t.line, backgroundColor: t.termBg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
            <View>
              {detail.split('\n').slice(0, 200).map((line, i) => {
                const color = isEdit && line.startsWith('+') ? '#3fb950'
                  : isEdit && line.startsWith('-') ? '#f85149'
                  : t.termTx;
                return <Text key={i} style={{ fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17, color }}>{line || ' '}</Text>;
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function StreamBlockBase({ message, canAnswer, onAnswer, onCopy }: { message: ChatMessage; canAnswer?: boolean; onAnswer?: (askId: string, answers: AnswerMap) => void; onCopy?: (text: string) => void }) {
  const t = useTheme();
  switch (message.kind) {
    case 'user':
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onLongPress={() => onCopy?.(message.text)} style={{ maxWidth: '84%', backgroundColor: t.acGhost, borderWidth: 1, borderColor: t.acLine, borderRadius: 16, borderBottomRightRadius: 5, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text style={{ color: t.tx, fontSize: 14.5, lineHeight: 21 }}>{message.text}</Text>
          </Pressable>
        </View>
      );
    case 'agent':
      return <Pressable onLongPress={() => onCopy?.(message.text)}><Markdown style={mdStyles(t) as any}>{message.text}</Markdown></Pressable>;
    case 'thought':
      return <ThoughtBlock text={message.text} t={t} onCopy={onCopy} />;
    case 'tool':
      return <ToolCard msg={message} t={t} onCopy={onCopy} />;
    case 'error':
      return <ErrorBlock text={message.text} t={t} onCopy={onCopy} />;
    case 'system':
      return <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingHorizontal: 12 }}>{message.text}</Text>;
    case 'ask':
      return <AskBlock askId={message.askId} status={message.status} questions={message.questions} canAnswer={!!canAnswer && message.status === 'pending'} onAnswer={onAnswer} t={t} />;
    default:
      return null;
  }
}

// 按内容比较：流式更新时消息数组会整体重建，只有真正变化的消息（通常是最后一条）才重渲染，
// 其余 Markdown 块不再反复解析/测量 —— 避免列表中间空白与高度跳动。
type MsgCmp = { id?: string; kind?: string; text?: string; title?: string; status?: string; questions?: unknown };
export const StreamBlock = React.memo(StreamBlockBase, (a, b) => {
  if (a.canAnswer !== b.canAnswer || a.onAnswer !== b.onAnswer || a.onCopy !== b.onCopy) return false;
  const m = a.message as MsgCmp;
  const n = b.message as MsgCmp;
  return (
    m.id === n.id &&
    m.kind === n.kind &&
    m.text === n.text &&
    m.title === n.title &&
    m.status === n.status &&
    m.questions === n.questions
  );
});

function AskBlock({ askId, status, questions, canAnswer, onAnswer, t }: { askId: string; status: string; questions: AskQuestion[]; canAnswer: boolean; onAnswer?: (askId: string, answers: AnswerMap) => void; t: Theme }) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[qi] ?? []);
      if (multi) { set.has(label) ? set.delete(label) : set.add(label); }
      else { set.clear(); set.add(label); }
      next[qi] = set;
      return next;
    });
  };

  const submit = () => {
    if (!onAnswer) return;
    const answers: AnswerMap = {};
    questions.forEach((q, qi) => {
      const set = selected[qi];
      if (!set || set.size === 0) return;
      answers[q.question] = q.multiSelect ? Array.from(set) : Array.from(set)[0];
    });
    if (Object.keys(answers).length === 0) return;
    setSubmitted(true);
    onAnswer(askId, answers);
  };

  const interactive = canAnswer && !submitted;
  const answered = status === 'completed';

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.acLine, borderRadius: 13, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icons.sparkle size={15} color={t.acTx} sw={1.8} />
        <Text style={{ color: t.acTx, fontSize: 13.5, fontWeight: '700', flex: 1 }}>AI 提问</Text>
        {answered ? <Text style={{ color: t.tx3, fontSize: 11.5 }}>已回答</Text> : null}
      </View>
      {questions.map((q, qi) => (
        <View key={qi} style={{ gap: 4 }}>
          {q.header ? <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '600' }}>{q.header}</Text> : null}
          <Text style={{ color: t.tx, fontSize: 13.5, lineHeight: 20 }}>{q.question}</Text>
          <View style={{ gap: 6, marginTop: 4 }}>
            {q.options.map((opt) => {
              const isSel = answered
                ? Array.isArray(q.answer) ? q.answer.includes(opt.label) : q.answer === opt.label
                : (selected[qi]?.has(opt.label) ?? false);
              return (
                <Pressable key={opt.label} disabled={!interactive} onPress={() => toggle(qi, opt.label, q.multiSelect)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: isSel ? t.ac : t.line, backgroundColor: isSel ? t.acGhost : 'transparent', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10 }}>
                  {q.multiSelect
                    ? <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: isSel ? t.ac : t.line2, backgroundColor: isSel ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{isSel ? <Icons.check size={12} color={t.acInk} sw={3} /> : null}</View>
                    : <View style={{ width: 18, height: 18, borderRadius: 99, borderWidth: 1.5, borderColor: isSel ? t.ac : t.line2, alignItems: 'center', justifyContent: 'center' }}>{isSel ? <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.ac }} /> : null}</View>}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: isSel ? t.tx : t.tx2, fontSize: 13.5, fontWeight: isSel ? '600' : '400' }}>{opt.label}</Text>
                    {opt.description ? <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>{opt.description}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {interactive ? (
        <Pressable onPress={submit} style={{ backgroundColor: t.ac, borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 2 }}>
          <Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>提交回答</Text>
        </Pressable>
      ) : !answered && status !== 'pending' ? (
        <Text style={{ color: t.tx3, fontSize: 11.5, fontStyle: 'italic' }}>该提问已失效（可在下方直接输入消息）</Text>
      ) : null}
    </View>
  );
}
