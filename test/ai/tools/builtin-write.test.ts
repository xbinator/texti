import type { AIToolContext } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { createBuiltinWriteTools } from '@/ai/tools/builtin/write';

function createContext() {
  let selection: { from: number; to: number; text: string } | null = { from: 2, to: 5, text: 'pha' };
  let documentContent = 'alpha beta';

  const context: AIToolContext = {
    document: {
      id: 'doc-1',
      title: 'My Note',
      path: '/tmp/my-note.md',
      getContent: () => documentContent
    },
    editor: {
      getSelection: () => selection,
      insertAtCursor: async (content: string) => {
        documentContent += content;
      },
      replaceSelection: async (content: string) => {
        documentContent = `replaced:${content}`;
        selection = { from: 2, to: 2 + content.length, text: content };
      },
      replaceDocument: async (content: string) => {
        documentContent = content;
      }
    }
  };

  return {
    context,
    getDocumentContent: () => documentContent,
    clearSelection: () => {
      selection = null;
    }
  };
}

describe('built-in write tools', () => {
  it('inserts content after confirmation', async () => {
    const confirm = vi.fn(async () => true);
    const tools = createBuiltinWriteTools({ confirm });
    const { context, getDocumentContent } = createContext();

    const result = await tools.insertAtCursor.execute({ content: ' ++' }, context);

    expect(result.status).toBe('success');
    expect(getDocumentContent()).toBe('alpha beta ++');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('adds custom input config to insert confirmation so users can override generated content', async () => {
    const confirm = vi.fn(async () => false);
    const tools = createBuiltinWriteTools({ confirm });
    const { context } = createContext();

    await tools.insertAtCursor.execute({ content: ' ++' }, context);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customInput: {
          enabled: true,
          placeholder: '输入你想插入的内容...',
          triggerLabel: '改成别的'
        }
      })
    );
  });

  it('returns cancelled when user rejects confirmation', async () => {
    const confirm = vi.fn(async () => false);
    const tools = createBuiltinWriteTools({ confirm });
    const { context, getDocumentContent } = createContext();

    const result = await tools.insertAtCursor.execute({ content: ' ++' }, context);

    expect(result.status).toBe('cancelled');
    expect(result.error?.code).toBe('USER_CANCELLED');
    expect(getDocumentContent()).toBe('alpha beta');
  });

  it('fails to replace selection when nothing is selected', async () => {
    const confirm = vi.fn(async () => true);
    const tools = createBuiltinWriteTools({ confirm });
    const { context, clearSelection } = createContext();

    clearSelection();
    const result = await tools.replaceSelection.execute({ content: 'new text' }, context);

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('NO_SELECTION');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('adds custom input config to replace-selection confirmation so users can override generated content', async () => {
    const confirm = vi.fn(async () => false);
    const tools = createBuiltinWriteTools({ confirm });
    const { context } = createContext();

    await tools.replaceSelection.execute({ content: 'new text' }, context);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customInput: {
          enabled: true,
          placeholder: '输入你想替换成的内容...',
          triggerLabel: '改成别的'
        }
      })
    );
  });

  it('replaces the full document after dangerous confirmation', async () => {
    const confirm = vi.fn(async (_request: AIToolConfirmationRequest) => true);
    const tools = createBuiltinWriteTools({ confirm });
    const { context, getDocumentContent } = createContext();

    const result = await tools.replaceDocument.execute({ content: '# rewritten' }, context);

    expect(result.status).toBe('success');
    expect(getDocumentContent()).toBe('# rewritten');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0].riskLevel).toBe('dangerous');
  });

  it('notifies adapter execution lifecycle around a confirmed write', async () => {
    const confirm = vi.fn(async () => true);
    const onExecutionStart = vi.fn();
    const onExecutionComplete = vi.fn();
    const tools = createBuiltinWriteTools({ confirm, onExecutionStart, onExecutionComplete });
    const { context } = createContext();

    const result = await tools.insertAtCursor.execute({ content: ' ++' }, context);

    expect(result.status).toBe('success');
    expect(onExecutionStart).toHaveBeenCalledTimes(1);
    expect(onExecutionComplete).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'insert_at_cursor' }),
      { status: 'success' }
    );
  });
});
