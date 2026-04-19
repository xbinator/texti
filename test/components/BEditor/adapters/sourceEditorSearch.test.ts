import { describe, expect, it } from 'vitest';
import { createSourceSearchState, findSourceSearchMatches } from '@/components/BEditor/adapters/sourceEditorSearch';

describe('sourceEditorSearch', () => {
  it('finds case-insensitive matches and tracks current result', () => {
    const content = 'Hello world\nhello again\nHELLO end';
    const matches = findSourceSearchMatches(content, 'hello');

    expect(matches).toHaveLength(3);
    expect(matches[0]).toEqual({ from: 0, to: 5 });
    expect(matches[1]).toEqual({ from: 12, to: 17 });
    expect(matches[2]).toEqual({ from: 24, to: 29 });

    expect(createSourceSearchState(content, 'hello')).toMatchObject({
      currentIndex: 0,
      matchCount: 3,
      term: 'hello'
    });
  });

  it('clamps and clears search state correctly', () => {
    const content = 'alpha beta alpha';

    expect(createSourceSearchState(content, 'alpha', 10)).toMatchObject({
      currentIndex: 1,
      matchCount: 2,
      term: 'alpha'
    });

    expect(createSourceSearchState(content, '')).toMatchObject({
      currentIndex: 0,
      matchCount: 0,
      term: ''
    });
  });
});
