import { base64Encode } from '../base64';
import { TaskMessageHandler, type RawChunk } from '../handler';

function acpChunk(update: Record<string, unknown>): RawChunk {
  return {
    event: 'task-running',
    kind: 'acp_event',
    data: base64Encode(JSON.stringify({ update })),
    timestamp: 1,
  };
}

describe('TaskMessageHandler', () => {
  it('renders question tool calls as ask messages and keeps expired status updates', () => {
    const handler = new TaskMessageHandler();

    handler.pushChunk(acpChunk({
      sessionUpdate: 'tool_call',
      toolCallId: 'ask-1',
      title: 'question',
      status: 'pending',
      rawInput: {
        questions: [{
          question: '继续吗？',
          options: [{ label: '继续' }, { label: '停止' }],
        }],
      },
    }));

    let state = handler.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      kind: 'ask',
      askId: 'ask-1',
      status: 'pending',
      questions: [{ question: '继续吗？', multiSelect: false }],
    });

    handler.pushChunk(acpChunk({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'ask-1',
      status: 'failed',
    }));

    state = handler.getState();
    expect(state.messages[0]).toMatchObject({
      kind: 'ask',
      askId: 'ask-1',
      status: 'failed',
    });
  });
});
