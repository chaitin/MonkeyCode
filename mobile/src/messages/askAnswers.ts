import type { AskQuestion } from './handler';

export type AnswerMap = Record<string, string | string[]>;

export const CUSTOM_ANSWER_KEY = '__monkeycode_custom_answer__';

export function buildAskAnswers(
  questions: AskQuestion[],
  selected: Record<number, Set<string>>,
  customAnswers: Record<number, string>,
): AnswerMap | null {
  if (questions.length === 0) return null;

  const answers: AnswerMap = {};
  for (let qi = 0; qi < questions.length; qi += 1) {
    const question = questions[qi];
    const choices = selected[qi];
    if (!choices || choices.size === 0) return null;

    const values: string[] = [];
    for (const choice of choices) {
      if (choice === CUSTOM_ANSWER_KEY) {
        const custom = (customAnswers[qi] ?? '').trim();
        if (!custom) return null;
        values.push(custom);
      } else {
        values.push(choice);
      }
    }

    answers[question.question] = question.multiSelect ? values : values[0];
  }

  return answers;
}
