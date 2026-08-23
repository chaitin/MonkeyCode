/** 在受控 textarea 的当前选区插入换行，并在 React 回写 value 后恢复光标。 */
export function insertNewlineAtSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  setValue: (value: string) => void,
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const cursor = start + 1;
  setValue(`${value.slice(0, start)}\n${value.slice(end)}`);
  queueMicrotask(() => textarea.setSelectionRange(cursor, cursor));
}
