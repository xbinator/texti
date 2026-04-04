import type { CommandProps, Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchSnapshot {
  currentIndex: number;
  matchCount: number;
  term: string;
}

export interface SearchScrollContext {
  editor: Editor;
  match: SearchMatch;
  targetElement: HTMLElement | null;
}

interface SearchOptions {
  onMatchFocus: ((context: SearchScrollContext) => void) | null;
}

interface SearchState {
  currentIndex: number;
  decorations: DecorationSet;
  matches: SearchMatch[];
  term: string;
}

interface SearchMeta {
  currentIndex?: number;
  term?: string;
}

interface SearchCommandContext {
  dispatch?: CommandProps['dispatch'];
  editor?: CommandProps['editor'];
  state: CommandProps['state'];
}

const searchPluginKey = new PluginKey<SearchState>('b-editor-search');

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatches(doc: CommandProps['state']['doc'], term: string): SearchMatch[] {
  if (!term) {
    return [];
  }

  const matches: SearchMatch[] = [];
  const pattern = new RegExp(escapeRegExp(term), 'gi');

  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }

    const text = node.text ?? '';
    pattern.lastIndex = 0;

    let match = pattern.exec(text);
    while (match) {
      matches.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length
      });

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }

      match = pattern.exec(text);
    }

    return true;
  });

  return matches;
}

function createDecorations(doc: CommandProps['state']['doc'], matches: SearchMatch[], currentIndex: number): DecorationSet {
  if (matches.length === 0) {
    return DecorationSet.create(doc, []);
  }

  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === currentIndex ? 'search-match search-match-current' : 'search-match'
    })
  );

  return DecorationSet.create(doc, decorations);
}

function createSearchState(doc: CommandProps['state']['doc'], term = '', currentIndex = 0): SearchState {
  const matches = findMatches(doc, term);
  const nextIndex = matches.length === 0 ? 0 : Math.min(currentIndex, matches.length - 1);

  return {
    currentIndex: nextIndex,
    decorations: createDecorations(doc, matches, nextIndex),
    matches,
    term
  };
}

function getSearchState(editor: CommandProps['editor']): SearchState {
  return searchPluginKey.getState(editor.state) ?? createSearchState(editor.state.doc);
}

export function getSearchSnapshot(editor: Editor | null | undefined): SearchSnapshot {
  if (!editor) {
    return {
      currentIndex: 0,
      matchCount: 0,
      term: ''
    };
  }

  const searchState = getSearchState(editor);

  return {
    currentIndex: searchState.currentIndex,
    matchCount: searchState.matches.length,
    term: searchState.term
  };
}

function getMatchElement(editor: Editor, match: SearchMatch): HTMLElement | null {
  const domAtPos = editor.view.domAtPos(match.from);
  const targetNode = domAtPos.node.nodeType === Node.TEXT_NODE ? domAtPos.node.parentElement : domAtPos.node;

  return targetNode instanceof HTMLElement ? targetNode : null;
}

function scrollMatchIntoView(editor: Editor, match: SearchMatch, onMatchFocus: SearchOptions['onMatchFocus']): void {
  requestAnimationFrame(() => {
    const targetElement = getMatchElement(editor, match);
    if (!targetElement) {
      return;
    }

    if (onMatchFocus) {
      onMatchFocus({ editor, match, targetElement });
      return;
    }

    targetElement.scrollIntoView({
      block: 'center',
      inline: 'nearest'
    });
  });
}

function dispatchSearchState(
  { dispatch, editor, state }: SearchCommandContext,
  nextSearchState: SearchState,
  onMatchFocus: SearchOptions['onMatchFocus']
): void {
  if (!dispatch) {
    return;
  }

  const transaction = state.tr.setMeta(searchPluginKey, {
    currentIndex: nextSearchState.currentIndex,
    term: nextSearchState.term
  });

  const currentMatch = nextSearchState.matches[nextSearchState.currentIndex];
  if (currentMatch) {
    const selection = TextSelection.create(state.doc, currentMatch.from, currentMatch.to);
    transaction.setSelection(selection).scrollIntoView();
  }

  dispatch(transaction);

  if (editor && currentMatch) {
    scrollMatchIntoView(editor, currentMatch, onMatchFocus);
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      clearSearch: () => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      setSearchTerm: (term: string) => ReturnType;
    };
  }
}

export const Search = Extension.create<SearchOptions>({
  name: 'search',

  addOptions() {
    return {
      onMatchFocus: null
    };
  },

  addCommands() {
    const { onMatchFocus } = this.options;

    return {
      setSearchTerm:
        (term: string) =>
        ({ dispatch, editor, state }) => {
          const nextState = createSearchState(state.doc, term.trim(), 0);
          dispatchSearchState({ dispatch, editor, state }, nextState, onMatchFocus);
          return true;
        },
      findNext:
        () =>
        ({ dispatch, editor, state }) => {
          const searchState = getSearchState(editor);
          if (searchState.matches.length === 0) {
            return false;
          }

          const nextState = createSearchState(state.doc, searchState.term, (searchState.currentIndex + 1) % searchState.matches.length);
          dispatchSearchState({ dispatch, editor, state }, nextState, onMatchFocus);
          return true;
        },
      findPrevious:
        () =>
        ({ dispatch, editor, state }) => {
          const searchState = getSearchState(editor);
          if (searchState.matches.length === 0) {
            return false;
          }

          const currentIndex = searchState.currentIndex <= 0 ? searchState.matches.length - 1 : searchState.currentIndex - 1;
          const nextState = createSearchState(state.doc, searchState.term, currentIndex);
          dispatchSearchState({ dispatch, editor, state }, nextState, onMatchFocus);
          return true;
        },
      clearSearch:
        () =>
        ({ dispatch, state }) => {
          dispatch?.(state.tr.setMeta(searchPluginKey, { currentIndex: 0, term: '' }));
          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: (_, state) => createSearchState(state.doc),
          apply(tr, pluginState, _oldState, newState) {
            const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;

            if (meta) {
              return createSearchState(newState.doc, meta.term ?? pluginState.term, meta.currentIndex ?? pluginState.currentIndex);
            }

            if (tr.docChanged && pluginState.term) {
              return createSearchState(newState.doc, pluginState.term, pluginState.currentIndex);
            }

            return pluginState;
          }
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)?.decorations ?? DecorationSet.create(state.doc, []);
          }
        }
      })
    ];
  }
});
