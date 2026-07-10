import { buildAskAnswers, CUSTOM_ANSWER_KEY } from '../askAnswers';
import type { AskQuestion } from '../handler';

const questions: AskQuestion[] = [
  {
    question: '选择处理方式',
    multiSelect: false,
    options: [{ label: '继续' }, { label: '停止' }],
  },
];

test('buildAskAnswers requires every question to have an answer', () => {
  expect(buildAskAnswers(questions, {}, {})).toBeNull();
});

test('buildAskAnswers replaces the custom marker with trimmed user input', () => {
  expect(buildAskAnswers(
    questions,
    { 0: new Set([CUSTOM_ANSWER_KEY]) },
    { 0: '  稍后处理  ' },
  )).toEqual({ 选择处理方式: '稍后处理' });
});

test('buildAskAnswers rejects an empty custom answer', () => {
  expect(buildAskAnswers(
    questions,
    { 0: new Set([CUSTOM_ANSWER_KEY]) },
    { 0: '   ' },
  )).toBeNull();
});
