import type { AIToolContext } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createBuiltinReadTools } from '@/ai/tools/builtin/read';

function createContext(content = 'alpha beta\nbeta gamma'): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'My Note',
      path: '/tmp/my-note.md',
      getContent: () => content
    },
    editor: {
      getSelection: () => ({ from: 1, to: 5, text: 'lpha' }),
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

describe('built-in read tools', () => {
  it('reads the current document', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.readCurrentDocument.execute({}, createContext());

    expect(result.status).toBe('success');
    expect(result.data).toEqual({
      id: 'doc-1',
      title: 'My Note',
      path: '/tmp/my-note.md',
      content: 'alpha beta\nbeta gamma'
    });
  });

  it('searches the current document case-insensitively', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.searchCurrentDocument.execute({ query: 'BETA' }, createContext());

    expect(result.status).toBe('success');
    expect(result.data).toEqual({
      query: 'BETA',
      matchCount: 2,
      matches: [
        { index: 6, preview: 'alpha beta\nbeta gamma' },
        { index: 11, preview: 'alpha beta\nbeta gamma' }
      ]
    });
  });

  it('rejects empty search input', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.searchCurrentDocument.execute({ query: '   ' }, createContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
