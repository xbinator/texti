import type { EditorSearchState } from './types';
import type { EditorState, Extension } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { EditorSelection, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export interface SourceSearchMatch {
  from: number;
  to: number;
}

interface SourceSearchMeta {
  currentIndex?: number;
  term?: string;
}

interface SourceSearchPluginState {
  currentIndex: number;
  decorations: DecorationSet;
  matches: SourceSearchMatch[];
  term: string;
}

interface SourceSearchState extends EditorSearchState {
  matches: SourceSearchMatch[];
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findSourceSearchMatches(content: string, term: string): SourceSearchMatch[] {
  if (!term) {
    return [];
  }

  const matches: SourceSearchMatch[] = [];
  const pattern = new RegExp(escapeRegExp(term), 'gi');
  let match = pattern.exec(content);

  while (match) {
    matches.push({ from: match.index, to: match.index + match[0].length });

    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }

    match = pattern.exec(content);
  }

  return matches;
}

function createSearchDecorations(matches: SourceSearchMatch[], currentIndex: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  matches.forEach((match: SourceSearchMatch, index: number): void => {
    builder.add(
      match.from,
      match.to,
      Decoration.mark({
        class: index === currentIndex ? 'search-match search-match-current' : 'search-match'
      })
    );
  });

  return builder.finish();
}

export function createSourceSearchState(content: string, term: string, currentIndex = 0): SourceSearchState {
  const matches = findSourceSearchMatches(content, term);
  const nextIndex = matches.length === 0 ? 0 : Math.min(currentIndex, matches.length - 1);

  return {
    currentIndex: nextIndex,
    matchCount: matches.length,
    matches,
    term
  };
}

function createPluginState(content: string, term = '', currentIndex = 0): SourceSearchPluginState {
  const state = createSourceSearchState(content, term, currentIndex);

  return {
    currentIndex: state.currentIndex,
    decorations: createSearchDecorations(state.matches, state.currentIndex),
    matches: state.matches,
    term: state.term
  };
}

const sourceSearchEffect = StateEffect.define<SourceSearchMeta>();

const sourceSearchStateField: StateField<SourceSearchPluginState> = StateField.define<SourceSearchPluginState>({
  create(state: EditorState): SourceSearchPluginState {
    return createPluginState(state.doc.toString());
  },
  update(value: SourceSearchPluginState, transaction): SourceSearchPluginState {
    const meta = transaction.effects.find((effect) => effect.is(sourceSearchEffect))?.value;

    if (meta) {
      return createPluginState(transaction.state.doc.toString(), meta.term ?? value.term, meta.currentIndex ?? value.currentIndex);
    }

    if (transaction.docChanged && value.term) {
      return createPluginState(transaction.state.doc.toString(), value.term, value.currentIndex);
    }

    return value;
  },
  provide(field: StateField<SourceSearchPluginState>): Extension {
    return EditorView.decorations.from(field, (value) => value.decorations);
  }
});

export function createSourceEditorSearchExtension(): Extension {
  return sourceSearchStateField;
}

export function getSourceEditorSearchState(state: EditorState): EditorSearchState {
  const searchState = state.field(sourceSearchStateField, false) ?? createPluginState(state.doc.toString());

  return {
    currentIndex: searchState.currentIndex,
    matchCount: searchState.matches.length,
    term: searchState.term
  };
}

function dispatchSearchState(view: EditorView, nextState: SourceSearchState): void {
  const effects = [
    sourceSearchEffect.of({
      currentIndex: nextState.currentIndex,
      term: nextState.term
    })
  ];
  const currentMatch = nextState.matches[nextState.currentIndex];

  view.dispatch({
    effects,
    selection: currentMatch ? EditorSelection.range(currentMatch.from, currentMatch.to) : undefined,
    scrollIntoView: Boolean(currentMatch)
  });
}

export function setSourceEditorSearchTerm(view: EditorView, term: string): void {
  const nextState = createSourceSearchState(view.state.doc.toString(), term.trim(), 0);
  dispatchSearchState(view, nextState);
}

export function findNextSourceEditorMatch(view: EditorView): void {
  const currentState = createSourceSearchState(
    view.state.doc.toString(),
    getSourceEditorSearchState(view.state).term,
    getSourceEditorSearchState(view.state).currentIndex
  );

  if (currentState.matches.length === 0) {
    return;
  }

  const nextState = createSourceSearchState(view.state.doc.toString(), currentState.term, (currentState.currentIndex + 1) % currentState.matches.length);

  dispatchSearchState(view, nextState);
}

export function findPreviousSourceEditorMatch(view: EditorView): void {
  const currentState = createSourceSearchState(
    view.state.doc.toString(),
    getSourceEditorSearchState(view.state).term,
    getSourceEditorSearchState(view.state).currentIndex
  );

  if (currentState.matches.length === 0) {
    return;
  }

  const nextIndex = currentState.currentIndex <= 0 ? currentState.matches.length - 1 : currentState.currentIndex - 1;
  dispatchSearchState(view, createSourceSearchState(view.state.doc.toString(), currentState.term, nextIndex));
}

export function clearSourceEditorSearch(view: EditorView): void {
  view.dispatch({
    effects: sourceSearchEffect.of({
      currentIndex: 0,
      term: ''
    })
  });
}
